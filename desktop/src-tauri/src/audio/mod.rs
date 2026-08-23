mod microphone;
mod pipeline;
mod system;

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex, MutexGuard,
};

use ringbuf::traits::{Consumer, Observer};
use ringbuf::HeapCons;
use tauri::{AppHandle, Manager};

use microphone::MicrophoneCapture;
use pipeline::DropCounter;
use system::SystemAudioCapture;

pub struct ReferenceSlot {
    stream: Option<ReferenceStream>,
    generation: u64,
}

struct ReferenceStream {
    consumer: HeapCons<f32>,
    sample_rate: u32,
    dropped: DropCounter,
}

pub struct ReferenceRead {
    pub active: bool,
    pub generation: u64,
    pub sample_rate: u32,
    pub samples: usize,
    pub skipped: usize,
    pub dropped: u64,
}

impl ReferenceSlot {
    fn new() -> Self {
        Self {
            stream: None,
            generation: 0,
        }
    }

    fn replace(&mut self, consumer: HeapCons<f32>, sample_rate: u32, dropped: DropCounter) {
        self.generation = self.generation.wrapping_add(1);
        self.stream = Some(ReferenceStream {
            consumer,
            sample_rate,
            dropped,
        });
    }

    fn clear(&mut self) {
        if self.stream.take().is_some() {
            self.generation = self.generation.wrapping_add(1);
        }
    }

    pub fn read(&mut self, output: &mut [f32], max_backlog: usize) -> ReferenceRead {
        let Some(stream) = self.stream.as_mut() else {
            return ReferenceRead {
                active: false,
                generation: self.generation,
                sample_rate: 0,
                samples: 0,
                skipped: 0,
                dropped: 0,
            };
        };

        let backlog = stream.consumer.occupied_len();
        let skipped = stream.consumer.skip(backlog.saturating_sub(max_backlog));
        let samples = stream.consumer.pop_slice(output);
        let dropped = stream.dropped.take();
        ReferenceRead {
            active: true,
            generation: self.generation,
            sample_rate: stream.sample_rate,
            samples,
            skipped,
            dropped,
        }
    }
}

pub type SharedReference = Arc<Mutex<ReferenceSlot>>;

#[derive(Default)]
struct CommandSequence {
    issued: AtomicU64,
    next: Mutex<u64>,
    ready: Condvar,
}

impl CommandSequence {
    fn issue(&self) -> u64 {
        self.issued.fetch_add(1, Ordering::Relaxed)
    }

    fn wait(&self, ticket: u64) -> CommandTurn<'_> {
        let mut next = self.next.lock().unwrap_or_else(|poisoned| {
            log::error!("audio.command_sequence_lock_recovered");
            poisoned.into_inner()
        });
        while *next != ticket {
            next = self.ready.wait(next).unwrap_or_else(|poisoned| {
                log::error!("audio.command_sequence_wait_recovered");
                poisoned.into_inner()
            });
        }
        CommandTurn {
            next,
            ready: &self.ready,
        }
    }
}

struct CommandTurn<'a> {
    next: MutexGuard<'a, u64>,
    ready: &'a Condvar,
}

impl Drop for CommandTurn<'_> {
    fn drop(&mut self) {
        *self.next = self.next.wrapping_add(1);
        self.ready.notify_all();
    }
}

#[derive(Default)]
struct Captures {
    microphone: Option<MicrophoneCapture>,
    system: Option<SystemAudioCapture>,
}

impl Captures {
    fn stop_all(&mut self, reference: &SharedReference) {
        if let Some(mut capture) = self.microphone.take() {
            capture.stop();
        }
        clear_reference(reference);
        if let Some(mut capture) = self.system.take() {
            capture.stop();
        }
    }
}

pub struct AudioState {
    captures: Mutex<Captures>,
    reference: SharedReference,
    commands: CommandSequence,
    shutting_down: AtomicBool,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            captures: Mutex::new(Captures::default()),
            reference: Arc::new(Mutex::new(ReferenceSlot::new())),
            commands: CommandSequence::default(),
            shutting_down: AtomicBool::new(false),
        }
    }

    fn start_microphone(&self, app: AppHandle) -> Result<(), String> {
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("audio is shutting down".to_string());
        }
        let mut captures = self.captures();
        if captures.microphone.is_some() {
            log::debug!("audio.microphone.start_ignored reason=already_running");
            return Ok(());
        }
        captures.microphone = Some(MicrophoneCapture::start(app, self.reference.clone())?);
        Ok(())
    }

    fn stop_microphone(&self) {
        let mut captures = self.captures();
        if let Some(mut capture) = captures.microphone.take() {
            capture.stop();
        }
    }

    fn start_system(&self, app: AppHandle) -> Result<(), String> {
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("audio is shutting down".to_string());
        }
        let mut captures = self.captures();
        if captures.system.is_some() {
            log::debug!("audio.system.start_ignored reason=already_running");
            return Ok(());
        }
        let (capture, reference, sample_rate, dropped) = SystemAudioCapture::start(app)?;
        lock_reference(&self.reference).replace(reference, sample_rate, dropped);
        captures.system = Some(capture);
        Ok(())
    }

    fn stop_system(&self) {
        let mut captures = self.captures();
        let Some(mut capture) = captures.system.take() else {
            return;
        };
        clear_reference(&self.reference);
        capture.stop();
    }

    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Release);
        self.captures().stop_all(&self.reference);
    }

    fn issue_command(&self) -> u64 {
        self.commands.issue()
    }

    fn run_command<T>(&self, ticket: u64, command: impl FnOnce() -> T) -> T {
        let _turn = self.commands.wait(ticket);
        command()
    }

    fn captures(&self) -> MutexGuard<'_, Captures> {
        self.captures.lock().unwrap_or_else(|poisoned| {
            log::error!("audio.state_lock_recovered");
            poisoned.into_inner()
        })
    }
}

impl Drop for AudioState {
    fn drop(&mut self) {
        let captures = self.captures.get_mut().unwrap_or_else(|poisoned| {
            log::error!("audio.state_drop_lock_recovered");
            poisoned.into_inner()
        });
        captures.stop_all(&self.reference);
    }
}

pub fn lock_reference(reference: &SharedReference) -> MutexGuard<'_, ReferenceSlot> {
    reference.lock().unwrap_or_else(|poisoned| {
        log::error!("audio.reference_lock_recovered");
        poisoned.into_inner()
    })
}

fn clear_reference(reference: &SharedReference) {
    lock_reference(reference).clear();
}

/// One-shot probe: create (and drop) the process tap that system-audio
/// capture uses. On macOS 14.2+ creating this tap is what raises the
/// Audio Capture permission prompt; it fails until the user grants it.
pub(crate) fn probe_system_audio() -> Result<(), String> {
    system::create_tap()
        .map(|_tap| ())
        .map_err(|error| format!("system audio tap unavailable ({error})"))
}

async fn run_blocking(
    operation: &'static str,
    task: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            log::error!("audio.command_panicked operation={operation} error={error}");
            format!("{operation} failed unexpectedly")
        })?
}

#[tauri::command]
pub async fn start_mic_audio(app: AppHandle) -> Result<(), String> {
    let ticket = app.state::<AudioState>().issue_command();
    let command_app = app.clone();
    run_blocking("start microphone", move || {
        let state = command_app.state::<AudioState>();
        state.run_command(ticket, || state.start_microphone(app))
    })
    .await
}

#[tauri::command]
pub async fn stop_mic_audio(app: AppHandle) -> Result<(), String> {
    let ticket = app.state::<AudioState>().issue_command();
    run_blocking("stop microphone", move || {
        let state = app.state::<AudioState>();
        state.run_command(ticket, || {
            state.stop_microphone();
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn start_system_audio(app: AppHandle) -> Result<(), String> {
    let ticket = app.state::<AudioState>().issue_command();
    let command_app = app.clone();
    run_blocking("start system audio", move || {
        let state = command_app.state::<AudioState>();
        state.run_command(ticket, || state.start_system(app))
    })
    .await
}

#[tauri::command]
pub async fn stop_system_audio(app: AppHandle) -> Result<(), String> {
    let ticket = app.state::<AudioState>().issue_command();
    run_blocking("stop system audio", move || {
        let state = app.state::<AudioState>();
        state.run_command(ticket, || {
            state.stop_system();
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::pipeline::audio_ring;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn audio_commands_execute_in_issue_order() {
        let sequence = Arc::new(CommandSequence::default());
        let first = sequence.issue();
        let second = sequence.issue();
        let (started_tx, started_rx) = mpsc::channel();
        let (completed_tx, completed_rx) = mpsc::channel();

        let later_sequence = sequence.clone();
        let later = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            let _turn = later_sequence.wait(second);
            completed_tx.send(second).unwrap();
        });

        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(completed_rx.try_recv().is_err());
        {
            let _turn = sequence.wait(first);
        }
        assert_eq!(
            completed_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            second
        );
        later.join().unwrap();
    }

    #[test]
    fn reference_generation_changes_only_with_the_active_stream() {
        let (_, first_consumer, first_dropped) = audio_ring();
        let (_, second_consumer, second_dropped) = audio_ring();
        let mut slot = ReferenceSlot::new();

        slot.clear();
        assert_eq!(slot.generation, 0);
        slot.replace(first_consumer, 48_000, first_dropped);
        assert_eq!(slot.generation, 1);
        slot.replace(second_consumer, 48_000, second_dropped);
        assert_eq!(slot.generation, 2);
        slot.clear();
        assert_eq!(slot.generation, 3);
        slot.clear();
        assert_eq!(slot.generation, 3);
    }
}
