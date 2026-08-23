use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use base64::Engine;
use cidre::cat;
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use rubato::{FftFixedInOut, Resampler};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const TARGET_SAMPLE_RATE: u32 = 24_000;
pub const RING_CAPACITY: usize = 48_000;
pub const IO_SCRATCH_SAMPLES: usize = 8_192;

const EVENT_CHUNK_SAMPLES: usize = TARGET_SAMPLE_RATE as usize / 10;
const PUMP_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SampleFormat {
    F32,
    F64,
    I16,
    I32,
}

pub fn sample_format(asbd: &cat::audio::StreamBasicDesc) -> Result<SampleFormat, String> {
    if asbd.format.0 != cat::audio::Format::LINEAR_PCM.0 {
        return Err(format!("unsupported audio format: {:?}", asbd.format));
    }

    let flags = asbd.format_flags.0;
    if flags & cat::audio::FormatFlags::IS_BIG_ENDIAN.0 != 0 {
        return Err("big-endian PCM is unsupported".to_string());
    }
    if flags & cat::audio::FormatFlags::IS_PACKED.0 == 0
        || flags & cat::audio::FormatFlags::IS_ALIGNED_HIGH.0 != 0
    {
        return Err("only packed PCM is supported".to_string());
    }

    let is_float = flags & cat::audio::FormatFlags::IS_FLOAT.0 != 0;
    let is_integer = flags & cat::audio::FormatFlags::IS_SIGNED_INTEGER.0 != 0;
    if is_float == is_integer {
        return Err(format!("unsupported PCM flags: {flags:#x}"));
    }
    if is_float {
        return match asbd.bits_per_channel {
            32 => Ok(SampleFormat::F32),
            64 => Ok(SampleFormat::F64),
            bits => Err(format!("unsupported float PCM width: {bits} bits")),
        };
    }
    if is_integer {
        return match asbd.bits_per_channel {
            16 => Ok(SampleFormat::I16),
            32 => Ok(SampleFormat::I32),
            bits => Err(format!("unsupported integer PCM width: {bits} bits")),
        };
    }

    Err(format!("unsupported PCM flags: {flags:#x}"))
}

pub fn sample_rate(asbd: &cat::audio::StreamBasicDesc) -> Result<u32, String> {
    let rate = asbd.sample_rate;
    if !rate.is_finite() || !(8_000.0..=384_000.0).contains(&rate) {
        return Err(format!("unsupported audio sample rate: {rate}"));
    }
    Ok(rate.round() as u32)
}

impl SampleFormat {
    fn bytes(self) -> usize {
        match self {
            Self::F32 | Self::I32 => 4,
            Self::F64 => 8,
            Self::I16 => 2,
        }
    }
}

pub struct CaptureConverter {
    format: SampleFormat,
    channels: usize,
    scratch: Box<[f32]>,
}

impl CaptureConverter {
    pub fn new(asbd: &cat::audio::StreamBasicDesc) -> Result<Self, String> {
        let format = sample_format(asbd)?;
        let declared_channels = asbd.channels_per_frame as usize;
        if declared_channels == 0 {
            return Err("audio stream has no channels".to_string());
        }
        if !asbd.is_interleaved() && declared_channels != 1 {
            return Err("non-interleaved multichannel PCM is unsupported".to_string());
        }
        let channels = if asbd.is_interleaved() {
            declared_channels
        } else {
            1
        };
        let expected_bytes = channels * format.bytes();
        if asbd.bytes_per_frame as usize != expected_bytes {
            return Err(format!(
                "unsupported PCM frame layout: expected {expected_bytes} bytes, got {}",
                asbd.bytes_per_frame
            ));
        }

        Ok(Self {
            format,
            channels,
            scratch: vec![0.0; IO_SCRATCH_SAMPLES].into_boxed_slice(),
        })
    }

    pub fn convert<'a>(&'a mut self, buffer: &cat::AudioBuf) -> (&'a [f32], usize) {
        let (written, dropped) = match self.format {
            SampleFormat::F32 => {
                convert_buffer(buffer, self.channels, &mut self.scratch, |sample: f32| {
                    sample
                })
            }
            SampleFormat::F64 => {
                convert_buffer(buffer, self.channels, &mut self.scratch, |sample: f64| {
                    sample as f32
                })
            }
            SampleFormat::I16 => {
                convert_buffer(buffer, self.channels, &mut self.scratch, |sample: i16| {
                    sample as f32 / 32_768.0
                })
            }
            SampleFormat::I32 => {
                convert_buffer(buffer, self.channels, &mut self.scratch, |sample: i32| {
                    sample as f32 / 2_147_483_648.0
                })
            }
        };
        (&self.scratch[..written], dropped)
    }
}

fn convert_buffer<T: Copy>(
    buffer: &cat::AudioBuf,
    channels: usize,
    output: &mut [f32],
    convert: impl Fn(T) -> f32,
) -> (usize, usize) {
    let Some(samples) = read_samples::<T>(buffer) else {
        return (0, 0);
    };
    downmix(samples, channels, output, convert)
}

fn read_samples<T: Copy>(buffer: &cat::AudioBuf) -> Option<&[T]> {
    let byte_count = buffer.data_bytes_size as usize;
    let sample_size = std::mem::size_of::<T>();
    let data = buffer.data.cast::<T>();
    if byte_count == 0
        || data.is_null()
        || byte_count % sample_size != 0
        || (data as usize) % std::mem::align_of::<T>() != 0
    {
        return None;
    }

    // Core Audio owns this memory for the duration of the IO callback. The
    // byte-count and alignment checks above make the typed view valid.
    Some(unsafe { std::slice::from_raw_parts(data, byte_count / sample_size) })
}

fn downmix<T: Copy>(
    samples: &[T],
    channels: usize,
    output: &mut [f32],
    convert: impl Fn(T) -> f32,
) -> (usize, usize) {
    let channels = channels.max(1);
    let frames = samples.len() / channels;
    let written = frames.min(output.len());
    for (destination, frame) in output[..written]
        .iter_mut()
        .zip(samples.chunks_exact(channels))
    {
        *destination = frame.iter().copied().map(&convert).sum::<f32>() / channels as f32;
    }
    (written, frames - written)
}

pub fn downmix_f32(samples: &[f32], channels: usize, output: &mut [f32]) -> (usize, usize) {
    downmix(samples, channels, output, |sample| sample)
}

#[derive(Clone, Default)]
pub struct DropCounter(Arc<AtomicU64>);

impl DropCounter {
    fn add(&self, count: usize) {
        self.0.fetch_add(count as u64, Ordering::Relaxed);
    }

    pub fn take(&self) -> u64 {
        self.0.swap(0, Ordering::Relaxed)
    }
}

pub struct RingWriter {
    producer: HeapProd<f32>,
    dropped: DropCounter,
}

impl RingWriter {
    pub fn push(&mut self, samples: &[f32]) {
        let written = self.producer.push_slice(samples);
        self.dropped.add(samples.len() - written);
    }

    pub fn record_dropped(&self, count: usize) {
        self.dropped.add(count);
    }
}

pub fn audio_ring() -> (RingWriter, HeapCons<f32>, DropCounter) {
    let (producer, consumer) = HeapRb::<f32>::new(RING_CAPACITY).split();
    let dropped = DropCounter::default();
    (
        RingWriter {
            producer,
            dropped: dropped.clone(),
        },
        consumer,
        dropped,
    )
}

pub struct AudioResampler {
    source_rate: u32,
    target_rate: u32,
    processor: Option<FftFixedInOut<f32>>,
    pending: VecDeque<f32>,
    input: Vec<f32>,
    output: Vec<f32>,
    delay: usize,
    delay_remaining: usize,
    total_input: u64,
    total_output: u64,
}

impl AudioResampler {
    pub fn new(source_rate: u32, target_rate: u32) -> Result<Self, String> {
        if source_rate == 0 || target_rate == 0 {
            return Err("audio sample rates must be positive".to_string());
        }
        if source_rate == target_rate {
            return Ok(Self {
                source_rate,
                target_rate,
                processor: None,
                pending: VecDeque::new(),
                input: Vec::new(),
                output: Vec::new(),
                delay: 0,
                delay_remaining: 0,
                total_input: 0,
                total_output: 0,
            });
        }

        let requested_chunk = (source_rate as usize / 100).max(1);
        let processor = FftFixedInOut::<f32>::new(
            source_rate as usize,
            target_rate as usize,
            requested_chunk,
            1,
        )
        .map_err(|error| format!("audio resampler unavailable: {error}"))?;
        let input = vec![0.0; processor.input_frames_next()];
        let output = vec![0.0; processor.output_frames_max()];
        let delay = processor.output_delay();
        Ok(Self {
            source_rate,
            target_rate,
            processor: Some(processor),
            pending: VecDeque::with_capacity(input.len() * 2),
            input,
            output,
            delay,
            delay_remaining: delay,
            total_input: 0,
            total_output: 0,
        })
    }

    pub fn push(&mut self, input: &[f32], destination: &mut Vec<f32>) -> Result<(), String> {
        self.total_input = self.total_input.saturating_add(input.len() as u64);
        if self.processor.is_none() {
            destination.extend_from_slice(input);
            self.total_output = self.total_output.saturating_add(input.len() as u64);
            return Ok(());
        }
        self.pending.extend(input.iter().copied());
        while self.pending.len() >= self.input.len() {
            self.process_next(destination, self.input.len())?;
        }
        Ok(())
    }

    pub fn finish(&mut self, destination: &mut Vec<f32>) -> Result<(), String> {
        if self.processor.is_none() {
            return Ok(());
        }
        if !self.pending.is_empty() {
            let remaining = self.pending.len();
            self.process_next(destination, remaining)?;
        }

        let expected = self.expected_output();
        while self.total_output < expected {
            let before = self.total_output;
            self.process_next(destination, 0)?;
            if self.total_output == before {
                return Err("audio resampler could not flush its filter delay".to_string());
            }
        }
        Ok(())
    }

    pub fn reset(&mut self) {
        self.pending.clear();
        if let Some(processor) = self.processor.as_mut() {
            processor.reset();
        }
        self.delay_remaining = self.delay;
        self.total_input = 0;
        self.total_output = 0;
    }

    fn process_next(
        &mut self,
        destination: &mut Vec<f32>,
        real_input_samples: usize,
    ) -> Result<(), String> {
        self.input.fill(0.0);
        for slot in self.input.iter_mut().take(real_input_samples) {
            let Some(sample) = self.pending.pop_front() else {
                return Err("audio resampler input queue became inconsistent".to_string());
            };
            *slot = sample;
        }

        let Some(processor) = self.processor.as_mut() else {
            return Err("audio resampler is inactive".to_string());
        };
        let (_, written) = processor
            .process_into_buffer(
                std::slice::from_ref(&self.input),
                std::slice::from_mut(&mut self.output),
                None,
            )
            .map_err(|error| format!("audio resampling failed: {error}"))?;

        let skipped = self.delay_remaining.min(written);
        self.delay_remaining -= skipped;
        let available = written - skipped;
        let needed = self.expected_output().saturating_sub(self.total_output) as usize;
        let copied = available.min(needed);
        destination.extend_from_slice(&self.output[skipped..skipped + copied]);
        self.total_output = self.total_output.saturating_add(copied as u64);
        Ok(())
    }

    fn expected_output(&self) -> u64 {
        (self.total_input * u64::from(self.target_rate) + u64::from(self.source_rate) / 2)
            / u64::from(self.source_rate)
    }
}

struct PcmChunker {
    pending: VecDeque<i16>,
    chunk_size: usize,
}

impl PcmChunker {
    fn new(chunk_size: usize) -> Self {
        Self {
            pending: VecDeque::with_capacity(chunk_size * 2),
            chunk_size,
        }
    }

    fn push(&mut self, samples: &[f32]) {
        self.pending.extend(samples.iter().copied().map(f32_to_i16));
    }

    fn take_full(&mut self) -> Option<Vec<i16>> {
        if self.pending.len() < self.chunk_size {
            return None;
        }
        Some(self.pending.drain(..self.chunk_size).collect())
    }

    fn take_tail(&mut self) -> Option<Vec<i16>> {
        (!self.pending.is_empty()).then(|| self.pending.drain(..).collect())
    }
}

fn f32_to_i16(sample: f32) -> i16 {
    let sample = sample.clamp(-1.0, 1.0);
    if sample < 0.0 {
        (sample * 32_768.0) as i16
    } else {
        (sample * 32_767.0) as i16
    }
}

pub fn pump(
    app: AppHandle,
    event: &'static str,
    mut consumer: HeapCons<f32>,
    stop: Arc<AtomicBool>,
    source_rate: u32,
    dropped: DropCounter,
) {
    let mut input = vec![0.0; IO_SCRATCH_SAMPLES];
    let mut converted = Vec::with_capacity(IO_SCRATCH_SAMPLES);
    let mut resampler = match AudioResampler::new(source_rate, TARGET_SAMPLE_RATE) {
        Ok(resampler) => resampler,
        Err(error) => {
            log::error!("audio.pipeline_start_failed event={event} error={error}");
            return;
        }
    };
    let mut chunker = PcmChunker::new(EVENT_CHUNK_SAMPLES);

    loop {
        let count = consumer.pop_slice(&mut input);
        if count > 0 {
            converted.clear();
            if let Err(error) = resampler.push(&input[..count], &mut converted) {
                log::error!("audio.resampling_failed event={event} error={error}");
                return;
            }
            chunker.push(&converted);
            while let Some(chunk) = chunker.take_full() {
                emit_chunk(&app, event, &chunk);
            }
        }

        if consumer.is_empty() && (stop.load(Ordering::Acquire) || !consumer.write_is_held()) {
            break;
        }
        if count == 0 {
            thread::park_timeout(PUMP_POLL_INTERVAL);
        }
    }

    converted.clear();
    if let Err(error) = resampler.finish(&mut converted) {
        log::error!("audio.resampling_flush_failed event={event} error={error}");
    } else {
        chunker.push(&converted);
    }
    if let Some(tail) = chunker.take_tail() {
        emit_chunk(&app, event, &tail);
    }
    let dropped = dropped.take();
    if dropped > 0 {
        log::warn!("audio.samples_dropped event={event} count={dropped}");
    }
}

#[derive(Clone, Serialize)]
struct AudioEvent<'a> {
    audio: &'a str,
}

fn emit_chunk(app: &AppHandle, event: &str, samples: &[i16]) {
    let mut bytes = Vec::with_capacity(std::mem::size_of_val(samples));
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    let audio = base64::engine::general_purpose::STANDARD.encode(bytes);
    if let Err(error) = app.emit_to("main", event, AudioEvent { audio: &audio }) {
        log::error!("audio.emit_failed event={event} error={error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mic_asbd() -> cat::audio::StreamBasicDesc {
        cat::audio::StreamBasicDesc {
            sample_rate: 48_000.0,
            format: cat::audio::Format::LINEAR_PCM,
            format_flags: cat::audio::FormatFlags(
                cat::audio::FormatFlags::IS_FLOAT.0 | cat::audio::FormatFlags::IS_PACKED.0,
            ),
            bytes_per_packet: 12,
            frames_per_packet: 1,
            bytes_per_frame: 12,
            channels_per_frame: 3,
            bits_per_channel: 32,
            reserved: 0,
        }
    }

    #[test]
    fn accepts_the_native_three_channel_microphone_contract() {
        let asbd = mic_asbd();
        assert_eq!(sample_format(&asbd), Ok(SampleFormat::F32));
        assert_eq!(sample_rate(&asbd), Ok(48_000));
        assert!(CaptureConverter::new(&asbd).is_ok());

        let mut unsupported = asbd;
        unsupported.bits_per_channel = 24;
        assert!(sample_format(&unsupported).is_err());

        let mut planar = asbd;
        planar.format_flags = cat::audio::FormatFlags(
            planar.format_flags.0 | cat::audio::FormatFlags::IS_NON_INTERLEAVED.0,
        );
        planar.bytes_per_frame = 4;
        assert!(CaptureConverter::new(&planar).is_err());
    }

    #[test]
    fn downmixes_complete_frames_and_reports_scratch_overflow() {
        let mut output = [0.0; 1];
        let (written, dropped) = downmix_f32(&[1.0, 3.0, 2.0, 4.0, 9.0], 2, &mut output);
        assert_eq!(written, 1);
        assert_eq!(dropped, 1);
        assert_eq!(output, [2.0]);
    }

    #[test]
    fn resampling_does_not_depend_on_ring_buffer_chunking() {
        let input: Vec<f32> = (0..17).map(|value| value as f32).collect();
        let mut whole = Vec::new();
        let mut whole_resampler = AudioResampler::new(48_000, 24_000).unwrap();
        whole_resampler.push(&input, &mut whole).unwrap();
        whole_resampler.finish(&mut whole).unwrap();

        let mut chunked = Vec::new();
        let mut resampler = AudioResampler::new(48_000, 24_000).unwrap();
        for chunk in input.chunks(3) {
            resampler.push(chunk, &mut chunked).unwrap();
        }
        resampler.finish(&mut chunked).unwrap();
        assert_eq!(chunked, whole);
    }

    #[test]
    fn resampling_preserves_stream_duration_after_filter_flush() {
        let input = vec![0.0; 44_100];
        let mut output = Vec::new();
        let mut resampler = AudioResampler::new(44_100, 48_000).unwrap();
        for chunk in input.chunks(127) {
            resampler.push(chunk, &mut output).unwrap();
        }
        resampler.finish(&mut output).unwrap();
        assert_eq!(output.len(), 48_000);
    }

    #[test]
    fn downsampling_filters_frequencies_above_the_target_nyquist_limit() {
        let input: Vec<f32> = (0..48_000)
            .map(|index| (2.0 * std::f32::consts::PI * 18_000.0 * index as f32 / 48_000.0).sin())
            .collect();
        let mut output = Vec::new();
        let mut resampler = AudioResampler::new(48_000, 24_000).unwrap();
        resampler.push(&input, &mut output).unwrap();
        resampler.finish(&mut output).unwrap();

        let steady_state = &output[1_000..];
        let rms = (steady_state
            .iter()
            .map(|sample| sample * sample)
            .sum::<f32>()
            / steady_state.len() as f32)
            .sqrt();
        assert!(rms < 0.05, "aliased tone RMS was {rms}");
    }

    #[test]
    fn chunker_preserves_a_partial_tail_for_shutdown() {
        let mut chunker = PcmChunker::new(3);
        chunker.push(&[0.0, 0.5, 1.0, -1.0]);
        assert_eq!(chunker.take_full(), Some(vec![0, 16_383, 32_767]));
        assert_eq!(chunker.take_tail(), Some(vec![i16::MIN]));
        assert_eq!(chunker.take_tail(), None);
    }

    #[test]
    fn ring_overflow_is_counted() {
        let (mut writer, _reader, dropped) = audio_ring();
        writer.push(&vec![0.0; RING_CAPACITY + 7]);
        assert_eq!(dropped.take(), 7);
    }
}
