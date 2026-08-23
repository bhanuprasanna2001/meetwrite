use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use cidre::{cat, cf, core_audio as ca, ns, os};
use ringbuf::HeapCons;
use tauri::AppHandle;

use super::pipeline::{audio_ring, pump, sample_rate, CaptureConverter, DropCounter, RingWriter};

pub const SYSTEM_AUDIO_EVENT: &str = "system-audio";

const TAP_NAME: &str = "meetwrite-audio-tap";

struct TapContext {
    converter: CaptureConverter,
    pipeline: RingWriter,
    reference: RingWriter,
}

extern "C" fn io_proc(
    _device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input_data: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output_data: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    context: Option<&mut TapContext>,
) -> os::Status {
    let Some(context) = context else {
        return os::Status::NO_ERR;
    };
    let TapContext {
        converter,
        pipeline,
        reference,
    } = context;
    let (samples, conversion_dropped) = converter.convert(&input_data.buffers[0]);
    pipeline.record_dropped(conversion_dropped);
    reference.record_dropped(conversion_dropped);
    pipeline.push(samples);
    reference.push(samples);
    os::Status::NO_ERR
}

pub struct SystemAudioCapture {
    device: Option<ca::hardware::StartedDevice<ca::AggregateDevice>>,
    context: Option<Box<TapContext>>,
    tap: Option<ca::TapGuard>,
    pump_thread: Option<JoinHandle<()>>,
    pump_stop: Arc<AtomicBool>,
    reference_dropped: DropCounter,
}

impl SystemAudioCapture {
    pub fn start(app: AppHandle) -> Result<(Self, HeapCons<f32>, u32, DropCounter), String> {
        let tap = create_tap().map_err(permission_hint)?;
        let tap_uid = tap
            .uid()
            .map_err(|error| stage_error("read tap identifier", error))?;
        let asbd = tap
            .asbd()
            .map_err(|error| stage_error("read tap format", error))?;
        let source_rate = sample_rate(&asbd)
            .map_err(|error| format!("System audio format is unsupported ({error})"))?;
        let converter = CaptureConverter::new(&asbd)
            .map_err(|error| format!("System audio format is unsupported ({error})"))?;

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap_uid.as_type_ref()],
        );
        let description = cf::DictionaryOf::with_keys_values(
            &[
                ca::aggregate_device_keys::is_private(),
                ca::aggregate_device_keys::tap_auto_start(),
                ca::aggregate_device_keys::name(),
                ca::aggregate_device_keys::uid(),
                ca::aggregate_device_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::String::from_str(TAP_NAME).as_ref(),
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );
        let aggregate = ca::AggregateDevice::with_desc(&description)
            .map_err(|error| stage_error("create aggregate device", error))?;
        let (pipeline_writer, pipeline_consumer, pipeline_dropped) = audio_ring();
        let (reference_writer, reference_consumer, reference_dropped) = audio_ring();
        let mut context = Box::new(TapContext {
            converter,
            pipeline: pipeline_writer,
            reference: reference_writer,
        });
        let proc_id = aggregate
            .create_io_proc_id(io_proc, Some(context.as_mut()))
            .map_err(|error| stage_error("register tap callback", error))?;
        let device = ca::device_start(aggregate, Some(proc_id))
            .map_err(|error| stage_error("start aggregate device", error))?;

        let pump_stop = Arc::new(AtomicBool::new(false));
        let pump_thread = match thread::Builder::new()
            .name("meetwrite-system-output".to_string())
            .spawn({
                let stop = pump_stop.clone();
                move || {
                    pump(
                        app,
                        SYSTEM_AUDIO_EVENT,
                        pipeline_consumer,
                        stop,
                        source_rate,
                        pipeline_dropped,
                    )
                }
            }) {
            Ok(thread) => thread,
            Err(error) => {
                stop_device(device);
                drop(context);
                return Err(format!("System audio output thread unavailable ({error})"));
            }
        };

        let reference_discontinuity = reference_dropped.clone();
        log::info!("audio.system_started sample_rate={source_rate}");
        Ok((
            Self {
                device: Some(device),
                context: Some(context),
                tap: Some(tap),
                pump_thread: Some(pump_thread),
                pump_stop,
                reference_dropped,
            },
            reference_consumer,
            source_rate,
            reference_discontinuity,
        ))
    }

    pub fn stop(&mut self) {
        let active = self.device.is_some()
            || self.context.is_some()
            || self.tap.is_some()
            || self.pump_thread.is_some();
        if let Some(device) = self.device.take() {
            stop_device(device);
        }
        drop(self.context.take());
        self.pump_stop.store(true, Ordering::Release);
        if let Some(thread) = self.pump_thread.take() {
            join_worker(thread);
        }
        drop(self.tap.take());
        let reference_dropped = self.reference_dropped.take();
        if reference_dropped > 0 {
            log::warn!("audio.reference_samples_dropped count={reference_dropped}");
        }
        if active {
            log::info!("audio.system_stopped");
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

fn stop_device(device: ca::hardware::StartedDevice<ca::AggregateDevice>) {
    if let Err(error) = device.stop() {
        log::error!("audio.system_device_stop_failed error={error}");
    }
}

fn join_worker(thread: JoinHandle<()>) {
    if thread.join().is_err() {
        log::error!("audio.worker_panicked worker=system-output");
    }
}

pub(super) fn create_tap() -> os::Result<ca::TapGuard> {
    ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new()).create_process_tap()
}

fn permission_hint(error: os::Error) -> String {
    format!(
        "System audio unavailable ({error}). Grant meetwrite Audio Capture or Screen Recording \
         in System Settings → Privacy & Security, then start the recording again."
    )
}

fn stage_error(stage: &str, error: os::Error) -> String {
    format!("System audio could not {stage} ({error})")
}
