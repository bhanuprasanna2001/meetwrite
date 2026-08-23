use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SupportedStreamConfig, SupportedStreamConfigRange};
use ringbuf::traits::{Consumer, Observer};
use ringbuf::HeapCons;
use tauri::AppHandle;
use webrtc_audio_processing::config::{EchoCanceller, HighPassFilter};
use webrtc_audio_processing::{Config, Processor, Stats};

use super::pipeline::{
    audio_ring, downmix_f32, pump, AudioResampler, DropCounter, RingWriter, IO_SCRATCH_SAMPLES,
};
use super::{lock_reference, ReferenceRead, SharedReference};

pub const MIC_AUDIO_EVENT: &str = "mic-audio";

const AEC_SAMPLE_RATE: u32 = 48_000;
const AEC_FRAME_SAMPLES: usize = AEC_SAMPLE_RATE as usize / 100;
const MAX_MIC_BACKLOG: usize = AEC_SAMPLE_RATE as usize / 5;
const MAX_REFERENCE_BACKLOG: usize = AEC_SAMPLE_RATE as usize / 5;
const WORKER_IDLE_POLL: Duration = Duration::from_millis(2);

// The mic and the system tap run on two independent device clocks. AEC3
// assumes the render and capture streams advance at the same rate, so drift
// is corrected one sample per 10 ms frame: slip down once the reference
// backlog reaches DRIFT_SLIP_DOWN_BACKLOG, slip up before it starves. Hard
// skips stay reserved for genuine discontinuities — each one makes AEC3
// forget its learned filter and leak echo for seconds while it re-converges.
const DRIFT_SLIP_DOWN_BACKLOG: usize = AEC_FRAME_SAMPLES * 5; // 50 ms ahead
const DRIFT_SLIP_UP_BACKLOG: usize = AEC_FRAME_SAMPLES * 2; // 20 ms to spare
const DRIFT_PRIME_FRAMES: u64 = 100; // 1 s of reference before slip-up
const ECHO_STATS_INTERVAL_FRAMES: u64 = 500; // ~5 s between diagnostics

// The capture is delayed by exactly CAPTURE_DELAY_FRAMES (60 ms) before AEC3
// and the transcript see it. A constant — never a gate — delay guarantees the
// reference is always ahead of the echo it must cancel (PulseAudio's own
// invariant: "playback should always be before capture"), and makes the saved
// mix exactly alignable: recorder.ts pads the system track by the same 60 ms.
const CAPTURE_DELAY_FRAMES: usize = 6;

struct FrameBuffer {
    samples: VecDeque<f32>,
}

impl FrameBuffer {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(AEC_FRAME_SAMPLES * 4),
        }
    }

    fn push(&mut self, samples: &[f32]) {
        self.samples.extend(samples.iter().copied());
    }

    fn pop_into(&mut self, frame: &mut [f32]) -> bool {
        if self.samples.len() < frame.len() {
            return false;
        }
        let count = frame.len();
        for (destination, sample) in frame.iter_mut().zip(self.samples.drain(..count)) {
            *destination = sample;
        }
        true
    }

    /// Pop one frame, slipping one sample to keep the two device clocks
    /// aligned: `-1` drops the oldest sample (the reference runs ahead),
    /// `+1` duplicates the first (the reference falls behind).
    fn pop_into_with_slip(&mut self, frame: &mut [f32], slip: i32) -> bool {
        if slip < 0 {
            if self.samples.len() < frame.len() + 1 {
                return false;
            }
            self.samples.pop_front();
            return self.pop_into(frame);
        }
        if slip > 0 {
            let consumed = frame.len().saturating_sub(1);
            if frame.is_empty() || self.samples.len() < consumed {
                return false;
            }
            let first = self.samples[0];
            for (destination, sample) in frame[1..].iter_mut().zip(self.samples.drain(..consumed)) {
                *destination = sample;
            }
            frame[0] = first;
            return true;
        }
        self.pop_into(frame)
    }

    fn len(&self) -> usize {
        self.samples.len()
    }

    fn pop_tail_into(&mut self, output: &mut [f32]) -> usize {
        let count = self.samples.len().min(output.len());
        for (destination, sample) in output[..count].iter_mut().zip(self.samples.drain(..count)) {
            *destination = sample;
        }
        count
    }

    fn clear(&mut self) {
        self.samples.clear();
    }
}

struct ResampledFrames {
    resampler: AudioResampler,
    converted: Vec<f32>,
    frames: FrameBuffer,
}

impl ResampledFrames {
    fn new(source_rate: u32) -> Result<Self, String> {
        Ok(Self {
            resampler: AudioResampler::new(source_rate, AEC_SAMPLE_RATE)?,
            converted: Vec::with_capacity(IO_SCRATCH_SAMPLES),
            frames: FrameBuffer::new(),
        })
    }

    fn push(&mut self, samples: &[f32]) -> Result<(), String> {
        self.converted.clear();
        self.resampler.push(samples, &mut self.converted)?;
        self.frames.push(&self.converted);
        Ok(())
    }

    fn finish(&mut self) -> Result<(), String> {
        self.converted.clear();
        self.resampler.finish(&mut self.converted)?;
        self.frames.push(&self.converted);
        Ok(())
    }

    fn reset(&mut self) {
        self.resampler.reset();
        self.converted.clear();
        self.frames.clear();
    }
}

struct ReferenceFrames {
    generation: Option<u64>,
    active: bool,
    sample_rate: u32,
    stream: Option<ResampledFrames>,
}

impl ReferenceFrames {
    fn new() -> Self {
        Self {
            generation: None,
            active: false,
            sample_rate: 0,
            stream: None,
        }
    }

    /// Returns true when the echo processor must forget its learned stream state.
    fn update(&mut self, read: ReferenceRead, samples: &[f32]) -> Result<bool, String> {
        let generation_changed = self.generation != Some(read.generation);
        let stream_changed = generation_changed
            || self.active != read.active
            || (read.active && self.sample_rate != read.sample_rate);
        let had_generation = self.generation.is_some();

        if stream_changed {
            let stream = if read.active {
                Some(ResampledFrames::new(read.sample_rate)?)
            } else {
                None
            };
            self.generation = Some(read.generation);
            self.active = read.active;
            self.sample_rate = read.sample_rate;
            self.stream = stream;
        }

        let discontinuity = read.skipped > 0 || read.dropped > 0;
        if discontinuity {
            if let Some(stream) = self.stream.as_mut() {
                stream.reset();
            }
            log::warn!(
                "audio.reference_discontinuity generation={} skipped={} dropped={}",
                read.generation,
                read.skipped,
                read.dropped
            );
        }

        if let Some(stream) = self.stream.as_mut() {
            stream.push(&samples[..read.samples])?;
        }
        Ok((stream_changed && had_generation) || discontinuity)
    }

    fn pop_into_with_slip(&mut self, frame: &mut [f32], slip: i32) -> bool {
        self.stream
            .as_mut()
            .is_some_and(|stream| stream.frames.pop_into_with_slip(frame, slip))
    }

    fn buffered(&self) -> usize {
        self.stream.as_ref().map_or(0, |stream| stream.frames.len())
    }
}

trait EchoProcessor {
    fn reinitialize(&mut self);
    fn analyze_render(&mut self, frame: &[f32]) -> Result<(), String>;
    fn process_capture(&mut self, frame: &mut [f32]) -> Result<(), String>;

    /// Periodic diagnostics; `None` for the test double.
    fn stats(&self) -> Option<Stats> {
        None
    }
}

struct WebRtcProcessor(Processor);

impl WebRtcProcessor {
    fn new() -> Result<Self, String> {
        let processor = Processor::new(AEC_SAMPLE_RATE)
            .map_err(|error| format!("echo canceller initialization failed: {error}"))?;
        processor.set_config(Config {
            high_pass_filter: Some(HighPassFilter::default()),
            echo_canceller: Some(EchoCanceller::default()),
            ..Default::default()
        });
        debug_assert_eq!(processor.num_samples_per_frame(), AEC_FRAME_SAMPLES);
        Ok(Self(processor))
    }
}

impl EchoProcessor for WebRtcProcessor {
    fn reinitialize(&mut self) {
        self.0.reinitialize();
    }

    fn analyze_render(&mut self, frame: &[f32]) -> Result<(), String> {
        self.0
            .analyze_render_frame(std::slice::from_ref(&frame))
            .map_err(|error| error.to_string())
    }

    fn process_capture(&mut self, frame: &mut [f32]) -> Result<(), String> {
        self.0
            .process_capture_frame(std::slice::from_mut(&mut &mut *frame))
            .map_err(|error| error.to_string())
    }

    fn stats(&self) -> Option<Stats> {
        Some(self.0.get_stats())
    }
}

/// The deterministic slip for this frame: `-1` (drop a sample) when the
/// reference has pulled ahead, `+1` (duplicate a sample) when it risks
/// starving, `0` otherwise. Slip-up waits until the reference has streamed
/// steadily (primed), so a late tap start is not mistaken for drift.
fn drift_slip(backlog: usize, reference_frames_seen: u64) -> i32 {
    if backlog >= DRIFT_SLIP_DOWN_BACKLOG {
        -1
    } else if reference_frames_seen >= DRIFT_PRIME_FRAMES && backlog <= DRIFT_SLIP_UP_BACKLOG {
        1
    } else {
        0
    }
}

/// Applies AEC only when a complete reference frame is available. On failure the
/// original capture frame is restored and the processor is disabled.
fn clean_frame<P: EchoProcessor>(
    processor: &mut Option<P>,
    reference: Option<&[f32]>,
    capture: &mut [f32],
    original: &mut [f32],
) -> Result<bool, String> {
    let Some(reference) = reference else {
        return Ok(false);
    };
    let Some(active) = processor.as_mut() else {
        return Ok(false);
    };

    original.copy_from_slice(capture);
    let result = active
        .analyze_render(reference)
        .and_then(|()| active.process_capture(capture));
    if let Err(error) = result {
        capture.copy_from_slice(original);
        *processor = None;
        return Err(error);
    }
    Ok(true)
}

fn choose_f32_config(
    configs: impl IntoIterator<Item = SupportedStreamConfigRange>,
) -> Option<SupportedStreamConfig> {
    configs
        .into_iter()
        .filter(|config| config.sample_format() == SampleFormat::F32)
        .map(|range| {
            let rate = AEC_SAMPLE_RATE.clamp(range.min_sample_rate(), range.max_sample_rate());
            let distance = rate.abs_diff(AEC_SAMPLE_RATE);
            let score = (distance, range.channels(), rate);
            (score, range.with_sample_rate(rate))
        })
        .min_by_key(|(score, _)| *score)
        .map(|(_, config)| config)
}

fn microphone_config(device: &cpal::Device) -> Result<SupportedStreamConfig, String> {
    let configs = device
        .supported_input_configs()
        .map_err(|error| format!("Microphone formats unavailable ({error})"))?;
    choose_f32_config(configs)
        .ok_or_else(|| "Microphone has no supported 32-bit float input format".to_string())
}

fn aec_loop(
    mut microphone: HeapCons<f32>,
    microphone_rate: u32,
    microphone_dropped: DropCounter,
    reference: SharedReference,
    mut clean: RingWriter,
) {
    let mut processor = match WebRtcProcessor::new() {
        Ok(processor) => Some(processor),
        Err(error) => {
            log::warn!("audio.echo_unavailable error={error}");
            None
        }
    };
    let mut microphone_stream = match ResampledFrames::new(microphone_rate) {
        Ok(stream) => stream,
        Err(error) => {
            log::error!("audio.microphone_resampler_failed error={error}");
            return;
        }
    };
    let mut reference_stream = ReferenceFrames::new();
    let mut microphone_input = vec![0.0; IO_SCRATCH_SAMPLES];
    let mut reference_input = vec![0.0; IO_SCRATCH_SAMPLES];
    let mut capture_frame = vec![0.0; AEC_FRAME_SAMPLES];
    let mut original_frame = vec![0.0; AEC_FRAME_SAMPLES];
    let mut render_frame = vec![0.0; AEC_FRAME_SAMPLES];
    let mut reference_frames_seen: u64 = 0;
    let mut frames_since_stats: u64 = 0;
    let mut capture_holdback = FrameBuffer::new();
    let mut finishing = false;

    loop {
        let dropped = microphone_dropped.take();
        let skipped = microphone.skip(microphone.occupied_len().saturating_sub(MAX_MIC_BACKLOG));
        if dropped > 0 || skipped > 0 {
            microphone_stream.reset();
            reference_stream = ReferenceFrames::new();
            if let Some(processor) = processor.as_mut() {
                processor.reinitialize();
            }
            log::warn!("audio.microphone_discontinuity dropped={dropped} skipped={skipped}");
        }

        let count = microphone.pop_slice(&mut microphone_input);
        if count > 0 {
            if let Err(error) = microphone_stream.push(&microphone_input[..count]) {
                log::error!("audio.microphone_resampling_failed error={error}");
                return;
            }
        } else if !microphone.write_is_held() && !finishing {
            finishing = true;
            if let Err(error) = microphone_stream.finish() {
                log::error!("audio.microphone_resampling_flush_failed error={error}");
                return;
            }
        }

        // Hold every capture frame back CAPTURE_DELAY_FRAMES before it is
        // processed, then release oldest-first. The delay is constant from
        // the first sample, so the mic track is uniformly 60 ms late and the
        // saved mix stays alignable; `finishing` drains the queue instead of
        // waiting for the lead to build up.
        while microphone_stream.frames.pop_into(&mut capture_frame) {
            capture_holdback.push(&capture_frame);
        }
        while capture_holdback.len() >= (CAPTURE_DELAY_FRAMES + 1) * AEC_FRAME_SAMPLES || finishing
        {
            if !capture_holdback.pop_into(&mut capture_frame) {
                break;
            }
            let reference_read =
                lock_reference(&reference).read(&mut reference_input, MAX_REFERENCE_BACKLOG);
            match reference_stream.update(reference_read, &reference_input) {
                Ok(true) => {
                    if let Some(processor) = processor.as_mut() {
                        processor.reinitialize();
                    }
                }
                Ok(false) => {}
                Err(error) => {
                    log::warn!("audio.reference_resampling_failed error={error}");
                }
            }

            // Drift control keeps the reference backlog inside [20 ms, 50 ms]
            // by slipping one sample per frame, so AEC3 stays aligned without
            // ever hard-skipping the reference (a skip reinitializes it).
            let slip = drift_slip(reference_stream.buffered(), reference_frames_seen);
            let has_reference = reference_stream.pop_into_with_slip(&mut render_frame, slip);
            if has_reference {
                reference_frames_seen = reference_frames_seen.saturating_add(1);
            }
            if let Err(error) = clean_frame(
                &mut processor,
                has_reference.then_some(render_frame.as_slice()),
                &mut capture_frame,
                &mut original_frame,
            ) {
                log::warn!("audio.echo_failed error={error}");
            }
            clean.push(&capture_frame);

            frames_since_stats += 1;
            if frames_since_stats >= ECHO_STATS_INTERVAL_FRAMES {
                frames_since_stats = 0;
                if let Some(stats) = processor.as_ref().and_then(|processor| processor.stats()) {
                    log::info!(
                        "audio.echo_stats erle={:?} delay_ms={:?} delay_stddev_ms={:?} divergent_frac={:?} reference_backlog={} reference_frames={}",
                        stats.echo_return_loss_enhancement,
                        stats.delay_ms,
                        stats.delay_standard_deviation_ms,
                        stats.divergent_filter_fraction,
                        reference_stream.buffered(),
                        reference_frames_seen,
                    );
                }
            }
        }

        if finishing {
            let tail = capture_holdback.pop_tail_into(&mut capture_frame);
            if tail > 0 {
                clean.push(&capture_frame[..tail]);
            }
        }
        if finishing && microphone.is_empty() && capture_holdback.len() == 0 {
            break;
        }
        if count == 0 {
            thread::park_timeout(WORKER_IDLE_POLL);
        }
    }

    let tail = microphone_stream.frames.pop_tail_into(&mut capture_frame);
    if tail > 0 {
        clean.push(&capture_frame[..tail]);
        log::debug!("audio.microphone_partial_frame_bypassed samples={tail}");
    }
}

pub struct MicrophoneCapture {
    stream: Option<cpal::Stream>,
    aec_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    pump_stop: Arc<AtomicBool>,
}

impl MicrophoneCapture {
    pub fn start(app: AppHandle, reference: SharedReference) -> Result<Self, String> {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or_else(|| "No input device for the microphone".to_string())?;
        let supported = microphone_config(&device)?;
        let channels = supported.channels() as usize;
        let microphone_rate = supported.sample_rate();

        let (mut microphone_writer, microphone_consumer, microphone_dropped) = audio_ring();
        let (clean_writer, clean_consumer, clean_dropped) = audio_ring();
        let aec_thread = thread::Builder::new()
            .name("meetwrite-microphone-aec".to_string())
            .spawn(move || {
                aec_loop(
                    microphone_consumer,
                    microphone_rate,
                    microphone_dropped,
                    reference,
                    clean_writer,
                )
            })
            .map_err(|error| format!("Microphone processing thread unavailable ({error})"))?;

        let mut scratch = vec![0.0; IO_SCRATCH_SAMPLES].into_boxed_slice();
        let stream = match device.build_input_stream(
            supported.config(),
            move |samples: &[f32], _| {
                let (written, dropped) = downmix_f32(samples, channels, &mut scratch);
                microphone_writer.record_dropped(dropped);
                microphone_writer.push(&scratch[..written]);
            },
            |error| log::error!("audio.microphone_stream_error error={error}"),
            None,
        ) {
            Ok(stream) => stream,
            Err(error) => {
                join_worker(aec_thread, "microphone-aec");
                return Err(format!("Microphone stream could not be created ({error})"));
            }
        };
        if let Err(error) = stream.play() {
            drop(stream);
            join_worker(aec_thread, "microphone-aec");
            return Err(format!("Microphone stream could not start ({error})"));
        }

        let pump_stop = Arc::new(AtomicBool::new(false));
        let pump_thread = match thread::Builder::new()
            .name("meetwrite-microphone-output".to_string())
            .spawn({
                let stop = pump_stop.clone();
                move || {
                    pump(
                        app,
                        MIC_AUDIO_EVENT,
                        clean_consumer,
                        stop,
                        AEC_SAMPLE_RATE,
                        clean_dropped,
                    )
                }
            }) {
            Ok(thread) => thread,
            Err(error) => {
                drop(stream);
                join_worker(aec_thread, "microphone-aec");
                return Err(format!("Microphone output thread unavailable ({error})"));
            }
        };

        log::info!("audio.microphone_started sample_rate={microphone_rate} channels={channels}");
        Ok(Self {
            stream: Some(stream),
            aec_thread: Some(aec_thread),
            pump_thread: Some(pump_thread),
            pump_stop,
        })
    }

    pub fn stop(&mut self) {
        let active =
            self.stream.is_some() || self.aec_thread.is_some() || self.pump_thread.is_some();
        if let Some(stream) = self.stream.take() {
            if let Err(error) = stream.pause() {
                log::warn!("audio.microphone_pause_failed error={error}");
            }
            drop(stream);
        }
        if let Some(thread) = self.aec_thread.take() {
            join_worker(thread, "microphone-aec");
        }
        self.pump_stop.store(true, Ordering::Release);
        if let Some(thread) = self.pump_thread.take() {
            join_worker(thread, "microphone-output");
        }
        if active {
            log::info!("audio.microphone_stopped");
        }
    }
}

impl Drop for MicrophoneCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

fn join_worker(thread: JoinHandle<()>, worker: &str) {
    if thread.join().is_err() {
        log::error!("audio.worker_panicked worker={worker}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cpal::{SupportedBufferSize, SupportedStreamConfigRange};

    #[derive(Default)]
    struct RecordingProcessor {
        calls: Vec<&'static str>,
    }

    impl EchoProcessor for RecordingProcessor {
        fn reinitialize(&mut self) {
            self.calls.push("reset");
        }

        fn analyze_render(&mut self, _frame: &[f32]) -> Result<(), String> {
            self.calls.push("render");
            Ok(())
        }

        fn process_capture(&mut self, frame: &mut [f32]) -> Result<(), String> {
            self.calls.push("capture");
            frame.fill(0.25);
            Ok(())
        }
    }

    #[test]
    fn frame_assembly_is_independent_of_callback_boundaries() {
        let input: Vec<f32> = (0..(AEC_FRAME_SAMPLES * 2 + 17))
            .map(|sample| sample as f32)
            .collect();
        let mut frames = FrameBuffer::new();
        for chunk in input.chunks(137) {
            frames.push(chunk);
        }

        let mut first = vec![0.0; AEC_FRAME_SAMPLES];
        let mut second = vec![0.0; AEC_FRAME_SAMPLES];
        let mut third = vec![0.0; AEC_FRAME_SAMPLES];
        assert!(frames.pop_into(&mut first));
        assert!(frames.pop_into(&mut second));
        assert!(!frames.pop_into(&mut third));
        assert_eq!(first, input[..AEC_FRAME_SAMPLES]);
        assert_eq!(second, input[AEC_FRAME_SAMPLES..AEC_FRAME_SAMPLES * 2]);
        let mut tail = vec![0.0; AEC_FRAME_SAMPLES];
        let tail_len = frames.pop_tail_into(&mut tail);
        assert_eq!(tail_len, 17);
        assert_eq!(&tail[..tail_len], &input[AEC_FRAME_SAMPLES * 2..]);
    }

    #[test]
    fn echo_processing_analyzes_render_before_capture_and_bypasses_without_it() {
        let mut processor = Some(RecordingProcessor::default());
        let reference = vec![0.5; AEC_FRAME_SAMPLES];
        let mut capture = vec![1.0; AEC_FRAME_SAMPLES];
        let mut original = vec![0.0; AEC_FRAME_SAMPLES];

        assert_eq!(
            clean_frame(
                &mut processor,
                Some(&reference),
                &mut capture,
                &mut original,
            ),
            Ok(true)
        );
        assert_eq!(processor.as_ref().unwrap().calls, ["render", "capture"]);
        assert!(capture.iter().all(|sample| *sample == 0.25));

        capture.fill(1.0);
        assert_eq!(
            clean_frame(&mut processor, None, &mut capture, &mut original),
            Ok(false)
        );
        assert!(capture.iter().all(|sample| *sample == 1.0));
        assert_eq!(processor.as_ref().unwrap().calls, ["render", "capture"]);
    }

    #[test]
    fn replacing_the_reference_discards_samples_from_the_previous_generation() {
        let mut reference = ReferenceFrames::new();
        let old = vec![1.0; AEC_FRAME_SAMPLES - 1];
        let new = vec![2.0; AEC_FRAME_SAMPLES];

        reference
            .update(
                ReferenceRead {
                    active: true,
                    generation: 1,
                    sample_rate: AEC_SAMPLE_RATE,
                    samples: old.len(),
                    skipped: 0,
                    dropped: 0,
                },
                &old,
            )
            .unwrap();
        assert!(reference
            .update(
                ReferenceRead {
                    active: true,
                    generation: 2,
                    sample_rate: AEC_SAMPLE_RATE,
                    samples: new.len(),
                    skipped: 0,
                    dropped: 0,
                },
                &new,
            )
            .unwrap());

        let mut frame = vec![0.0; AEC_FRAME_SAMPLES];
        assert!(reference.pop_into_with_slip(&mut frame, 0));
        assert!(frame.iter().all(|sample| *sample == 2.0));
    }

    #[test]
    fn reference_loss_discards_buffered_samples() {
        let mut reference = ReferenceFrames::new();
        let stale = vec![1.0; AEC_FRAME_SAMPLES - 1];
        let fresh = vec![2.0; AEC_FRAME_SAMPLES];

        reference
            .update(
                ReferenceRead {
                    active: true,
                    generation: 1,
                    sample_rate: AEC_SAMPLE_RATE,
                    samples: stale.len(),
                    skipped: 0,
                    dropped: 0,
                },
                &stale,
            )
            .unwrap();
        assert!(reference
            .update(
                ReferenceRead {
                    active: true,
                    generation: 1,
                    sample_rate: AEC_SAMPLE_RATE,
                    samples: fresh.len(),
                    skipped: 0,
                    dropped: 1,
                },
                &fresh,
            )
            .unwrap());

        let mut frame = vec![0.0; AEC_FRAME_SAMPLES];
        assert!(reference.pop_into_with_slip(&mut frame, 0));
        assert!(frame.iter().all(|sample| *sample == 2.0));
    }

    #[test]
    fn reference_frames_are_assembled_across_callback_boundaries() {
        let mut reference = ReferenceFrames::new();
        let first = vec![1.0; 256];
        let second = vec![2.0; AEC_FRAME_SAMPLES - first.len()];
        let read = |samples: usize| ReferenceRead {
            active: true,
            generation: 1,
            sample_rate: AEC_SAMPLE_RATE,
            samples,
            skipped: 0,
            dropped: 0,
        };

        reference.update(read(first.len()), &first).unwrap();
        let mut frame = vec![0.0; AEC_FRAME_SAMPLES];
        assert!(!reference.pop_into_with_slip(&mut frame, 0));
        reference.update(read(second.len()), &second).unwrap();
        assert!(reference.pop_into_with_slip(&mut frame, 0));
        assert!(frame[..first.len()].iter().all(|sample| *sample == 1.0));
        assert!(frame[first.len()..].iter().all(|sample| *sample == 2.0));
    }

    #[test]
    fn microphone_configuration_prefers_f32_at_the_aec_rate() {
        let i16_range = SupportedStreamConfigRange::new(
            1,
            48_000,
            48_000,
            SupportedBufferSize::Unknown,
            SampleFormat::I16,
        );
        let f32_44k = SupportedStreamConfigRange::new(
            1,
            44_100,
            44_100,
            SupportedBufferSize::Unknown,
            SampleFormat::F32,
        );
        let f32_48k = SupportedStreamConfigRange::new(
            2,
            44_100,
            96_000,
            SupportedBufferSize::Unknown,
            SampleFormat::F32,
        );

        let selected = choose_f32_config([i16_range, f32_44k, f32_48k]).unwrap();
        assert_eq!(selected.sample_format(), SampleFormat::F32);
        assert_eq!(selected.sample_rate(), AEC_SAMPLE_RATE);
        assert_eq!(selected.channels(), 2);
    }

    #[test]
    fn slip_down_drops_the_oldest_sample_when_the_reference_runs_ahead() {
        let mut frames = FrameBuffer::new();
        let input: Vec<f32> = (0..(AEC_FRAME_SAMPLES + 1))
            .map(|sample| sample as f32)
            .collect();
        frames.push(&input);

        let mut frame = vec![0.0; AEC_FRAME_SAMPLES];
        assert!(frames.pop_into_with_slip(&mut frame, -1));
        assert_eq!(frame, input[1..].to_vec());
        assert_eq!(frames.len(), 0);
    }

    #[test]
    fn slip_up_duplicates_the_first_sample_when_the_reference_lags() {
        let mut frames = FrameBuffer::new();
        let input: Vec<f32> = (0..(AEC_FRAME_SAMPLES - 1))
            .map(|sample| sample as f32)
            .collect();
        frames.push(&input);

        let mut frame = vec![0.0; AEC_FRAME_SAMPLES];
        assert!(frames.pop_into_with_slip(&mut frame, 1));
        assert_eq!(&frame[..2], &[0.0, 0.0]);
        assert_eq!(&frame[2..], &input[1..]);
        assert_eq!(frames.len(), 0);
    }

    #[test]
    fn slip_needs_the_reference_to_cover_the_consumed_samples() {
        let mut frames = FrameBuffer::new();
        frames.push(&[1.0; AEC_FRAME_SAMPLES - 1]);

        let mut frame = vec![0.0; AEC_FRAME_SAMPLES];
        assert!(!frames.pop_into_with_slip(&mut frame, -1));
        assert!(!frames.pop_into_with_slip(&mut frame, 0));
        assert!(frames.pop_into_with_slip(&mut frame, 1));
    }

    #[test]
    fn drift_slip_corrects_only_after_the_reference_is_primed() {
        assert_eq!(drift_slip(DRIFT_SLIP_DOWN_BACKLOG, 0), -1);
        assert_eq!(drift_slip(DRIFT_SLIP_UP_BACKLOG, DRIFT_PRIME_FRAMES - 1), 0);
        assert_eq!(drift_slip(DRIFT_SLIP_UP_BACKLOG, DRIFT_PRIME_FRAMES), 1);
        assert_eq!(
            drift_slip(
                DRIFT_SLIP_UP_BACKLOG + AEC_FRAME_SAMPLES,
                DRIFT_PRIME_FRAMES
            ),
            0
        );
    }
}
