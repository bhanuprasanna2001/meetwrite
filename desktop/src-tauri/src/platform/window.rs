use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use objc2::MainThreadMarker;
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowTitleVisibility};
use serde::{Deserialize, Serialize};
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewWindow};

const NORMAL_SIZE: LogicalSize<f64> = LogicalSize::new(1100.0, 600.0);
const MODE_ANIMATION_DURATION: Duration = Duration::from_millis(350);
const FRAME_INTERVAL: Duration = Duration::from_millis(16);
const MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowMode {
    Normal,
    Fullscreen,
    Meeting,
}

impl WindowMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Fullscreen => "fullscreen",
            Self::Meeting => "meeting",
        }
    }
}

#[derive(Default)]
pub struct WindowController {
    generation: Arc<AtomicU64>,
}

impl WindowController {
    pub fn new() -> Self {
        Self::default()
    }

    fn begin(&self) -> Generation {
        let value = self
            .generation
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        Generation {
            shared: Arc::clone(&self.generation),
            value,
        }
    }
}

#[derive(Clone)]
struct Generation {
    shared: Arc<AtomicU64>,
    value: u64,
}

impl Generation {
    fn is_current(&self) -> bool {
        self.shared.load(Ordering::Acquire) == self.value
    }

    fn invalidate(&self) {
        let _ = self.shared.compare_exchange(
            self.value,
            self.value.wrapping_add(1),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Frame {
    size: LogicalSize<f64>,
    position: LogicalPosition<f64>,
}

impl Frame {
    fn interpolate(self, target: Self, progress: f64) -> Self {
        let progress = ease_in_out(progress);
        Self {
            size: LogicalSize::new(
                lerp(self.size.width, target.size.width, progress),
                lerp(self.size.height, target.size.height, progress),
            ),
            position: LogicalPosition::new(
                lerp(self.position.x, target.position.x, progress),
                lerp(self.position.y, target.position.y, progress),
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TransitionOutcome {
    Applied,
    Superseded,
}

enum MainThreadOutcome<T> {
    Applied(T),
    Superseded,
}

pub fn configure_native_window(window: &WebviewWindow) -> Result<(), String> {
    let _main_thread = MainThreadMarker::new()
        .ok_or_else(|| "native window configuration must run on the main thread".to_owned())?;
    let raw_window = window
        .ns_window()
        .map_err(|error| format!("failed to get native window: {error}"))?;
    let native = NonNull::new(raw_window.cast::<NSWindow>())
        .ok_or_else(|| "native window pointer is null".to_owned())?;

    // Tauri owns this live NSWindow; setup keeps access on the main thread.
    let native = unsafe { native.as_ref() };
    for kind in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = native.standardWindowButton(kind) {
            button.setHidden(true);
        }
    }
    native.setTitleVisibility(NSWindowTitleVisibility::Hidden);

    log::info!("window.native_configured title_hidden=true");
    Ok(())
}

fn target_geometry(
    mode: WindowMode,
    monitor_size: LogicalSize<f64>,
    monitor_position: LogicalPosition<f64>,
) -> Option<Frame> {
    match mode {
        WindowMode::Normal => Some(Frame {
            size: NORMAL_SIZE,
            position: LogicalPosition::new(
                monitor_position.x + (monitor_size.width - NORMAL_SIZE.width) / 2.0,
                monitor_position.y + (monitor_size.height - NORMAL_SIZE.height) / 2.0,
            ),
        }),
        WindowMode::Meeting => {
            let width = monitor_size.width / 3.0;
            Some(Frame {
                size: LogicalSize::new(width, monitor_size.height),
                position: LogicalPosition::new(
                    monitor_position.x + monitor_size.width - width,
                    monitor_position.y,
                ),
            })
        }
        WindowMode::Fullscreen => None,
    }
}

fn ease_in_out(progress: f64) -> f64 {
    if progress < 0.5 {
        4.0 * progress * progress * progress
    } else {
        1.0 - (-2.0 * progress + 2.0).powi(3) / 2.0
    }
}

fn lerp(from: f64, to: f64, progress: f64) -> f64 {
    from + (to - from) * progress
}

fn on_main_thread<T, F>(
    window: &WebviewWindow,
    generation: &Generation,
    operation: F,
) -> Result<MainThreadOutcome<T>, String>
where
    T: Send + 'static,
    F: FnOnce(&WebviewWindow, &Generation) -> Result<T, String> + Send + 'static,
{
    if !generation.is_current() {
        return Ok(MainThreadOutcome::Superseded);
    }

    let (sender, receiver) = mpsc::sync_channel(1);
    let task_window = window.clone();
    let task_generation = generation.clone();
    window
        .run_on_main_thread(move || {
            let outcome = if task_generation.is_current() {
                operation(&task_window, &task_generation).map(MainThreadOutcome::Applied)
            } else {
                Ok(MainThreadOutcome::Superseded)
            };
            let _ = sender.send(outcome);
        })
        .map_err(|error| format!("failed to queue main-thread window operation: {error}"))?;

    match receiver.recv_timeout(MAIN_THREAD_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            generation.invalidate();
            Err("main-thread window operation timed out".to_owned())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            generation.invalidate();
            Err("main-thread window operation disconnected".to_owned())
        }
    }
}

fn prepare_animation(
    window: &WebviewWindow,
    mode: WindowMode,
    generation: &Generation,
) -> Result<MainThreadOutcome<Option<(Frame, Frame)>>, String> {
    on_main_thread(window, generation, move |window, generation| {
        if window
            .is_fullscreen()
            .map_err(|error| format!("failed to read fullscreen state: {error}"))?
        {
            if !generation.is_current() {
                return Ok(None);
            }
            window
                .set_fullscreen(false)
                .map_err(|error| format!("failed to leave fullscreen: {error}"))?;
        }

        if mode == WindowMode::Meeting {
            if !generation.is_current() {
                return Ok(None);
            }
            window
                .set_min_size(None::<LogicalSize<f64>>)
                .map_err(|error| format!("failed to clear normal size floor: {error}"))?;
        }

        if !generation.is_current() {
            return Ok(None);
        }
        let monitor = window
            .current_monitor()
            .map_err(|error| format!("failed to read current monitor: {error}"))?
            .ok_or_else(|| "current monitor is unavailable".to_owned())?;
        let scale = monitor.scale_factor();
        let monitor_size = monitor.size().to_logical::<f64>(scale);
        let monitor_position = monitor.position().to_logical::<f64>(scale);
        let target = target_geometry(mode, monitor_size, monitor_position)
            .ok_or_else(|| "fullscreen does not have frame geometry".to_owned())?;
        let current = Frame {
            size: window
                .outer_size()
                .map_err(|error| format!("failed to read window size: {error}"))?
                .to_logical::<f64>(scale),
            position: window
                .outer_position()
                .map_err(|error| format!("failed to read window position: {error}"))?
                .to_logical::<f64>(scale),
        };
        Ok(Some((current, target)))
    })
}

fn apply_frame(
    window: &WebviewWindow,
    frame: Frame,
    restore_normal_floor: bool,
    generation: &Generation,
) -> Result<MainThreadOutcome<bool>, String> {
    on_main_thread(window, generation, move |window, generation| {
        if !generation.is_current() {
            return Ok(false);
        }
        window
            .set_size(frame.size)
            .map_err(|error| format!("failed to set window size: {error}"))?;

        if !generation.is_current() {
            return Ok(false);
        }
        window
            .set_position(frame.position)
            .map_err(|error| format!("failed to set window position: {error}"))?;

        if restore_normal_floor && generation.is_current() {
            window
                .set_min_size(Some(NORMAL_SIZE))
                .map_err(|error| format!("failed to restore normal size floor: {error}"))?;
        }
        Ok(generation.is_current())
    })
}

fn animate_window(
    window: &WebviewWindow,
    from: Frame,
    target: Frame,
    restore_normal_floor: bool,
    generation: &Generation,
) -> Result<TransitionOutcome, String> {
    let started = Instant::now();
    loop {
        if !generation.is_current() {
            return Ok(TransitionOutcome::Superseded);
        }

        let progress =
            (started.elapsed().as_secs_f64() / MODE_ANIMATION_DURATION.as_secs_f64()).min(1.0);
        let finished = progress >= 1.0;
        let frame = if finished {
            target
        } else {
            from.interpolate(target, progress)
        };

        match apply_frame(window, frame, finished && restore_normal_floor, generation)? {
            MainThreadOutcome::Applied(true) => {}
            MainThreadOutcome::Applied(false) => return Ok(TransitionOutcome::Superseded),
            MainThreadOutcome::Superseded => return Ok(TransitionOutcome::Superseded),
        }
        if finished {
            return Ok(TransitionOutcome::Applied);
        }
        thread::sleep(FRAME_INTERVAL);
    }
}

fn toggle_fullscreen(
    window: &WebviewWindow,
    generation: &Generation,
) -> Result<TransitionOutcome, String> {
    match on_main_thread(window, generation, |window, generation| {
        let fullscreen = window
            .is_fullscreen()
            .map_err(|error| format!("failed to read fullscreen state: {error}"))?;
        if generation.is_current() {
            window
                .set_fullscreen(!fullscreen)
                .map_err(|error| format!("failed to toggle fullscreen: {error}"))?;
            return Ok(true);
        }
        Ok(false)
    })? {
        MainThreadOutcome::Applied(true) => Ok(TransitionOutcome::Applied),
        MainThreadOutcome::Applied(false) => Ok(TransitionOutcome::Superseded),
        MainThreadOutcome::Superseded => Ok(TransitionOutcome::Superseded),
    }
}

fn transition(
    window: &WebviewWindow,
    mode: WindowMode,
    generation: &Generation,
) -> Result<TransitionOutcome, String> {
    if mode == WindowMode::Fullscreen {
        return toggle_fullscreen(window, generation);
    }

    match prepare_animation(window, mode, generation)? {
        MainThreadOutcome::Applied(Some((from, target))) => {
            animate_window(window, from, target, mode == WindowMode::Normal, generation)
        }
        MainThreadOutcome::Applied(None) => Ok(TransitionOutcome::Superseded),
        MainThreadOutcome::Superseded => Ok(TransitionOutcome::Superseded),
    }
}

#[tauri::command]
pub async fn set_window_mode(window: WebviewWindow, mode: WindowMode) -> Result<(), String> {
    let controller = window
        .app_handle()
        .try_state::<WindowController>()
        .ok_or_else(|| "window controller is unavailable".to_owned())?;
    let generation = controller.begin();
    let worker_generation = generation.clone();
    let worker_window = window.clone();

    log::info!(
        "window.transition_started mode={} generation={}",
        mode.as_str(),
        generation.value
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        transition(&worker_window, mode, &worker_generation)
    })
    .await;

    match result {
        Ok(Ok(TransitionOutcome::Applied)) => {
            log::info!(
                "window.transition_finished mode={} generation={}",
                mode.as_str(),
                generation.value
            );
            Ok(())
        }
        Ok(Ok(TransitionOutcome::Superseded)) => {
            log::debug!(
                "window.transition_superseded mode={} generation={}",
                mode.as_str(),
                generation.value
            );
            Ok(())
        }
        Ok(Err(error)) => {
            generation.invalidate();
            log::error!(
                "window.transition_failed mode={} generation={} error={error}",
                mode.as_str(),
                generation.value
            );
            Err(error)
        }
        Err(error) => {
            generation.invalidate();
            let error = format!("window transition worker failed: {error}");
            log::error!(
                "window.transition_failed mode={} generation={} error={error}",
                mode.as_str(),
                generation.value
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_geometry_matches_window_modes_and_monitors() {
        let cases = [
            (
                WindowMode::Normal,
                LogicalSize::new(1440.0, 900.0),
                LogicalPosition::new(0.0, 0.0),
                Some(Frame {
                    size: LogicalSize::new(1100.0, 600.0),
                    position: LogicalPosition::new(170.0, 150.0),
                }),
            ),
            (
                WindowMode::Normal,
                LogicalSize::new(1920.0, 1080.0),
                LogicalPosition::new(-1920.0, 0.0),
                Some(Frame {
                    size: LogicalSize::new(1100.0, 600.0),
                    position: LogicalPosition::new(-1510.0, 240.0),
                }),
            ),
            (
                WindowMode::Meeting,
                LogicalSize::new(1440.0, 900.0),
                LogicalPosition::new(0.0, 0.0),
                Some(Frame {
                    size: LogicalSize::new(480.0, 900.0),
                    position: LogicalPosition::new(960.0, 0.0),
                }),
            ),
            (
                WindowMode::Meeting,
                LogicalSize::new(1920.0, 1080.0),
                LogicalPosition::new(-1920.0, 100.0),
                Some(Frame {
                    size: LogicalSize::new(640.0, 1080.0),
                    position: LogicalPosition::new(-640.0, 100.0),
                }),
            ),
            (
                WindowMode::Fullscreen,
                LogicalSize::new(1440.0, 900.0),
                LogicalPosition::new(0.0, 0.0),
                None,
            ),
        ];

        for (mode, size, position, expected) in cases {
            assert_eq!(target_geometry(mode, size, position), expected);
        }
    }

    #[test]
    fn generations_supersede_every_older_transition() {
        let controller = WindowController::new();
        let generations = [controller.begin(), controller.begin(), controller.begin()];
        let expected = [false, false, true];

        for (generation, expected_current) in generations.iter().zip(expected) {
            assert_eq!(generation.is_current(), expected_current);
        }

        generations[2].invalidate();
        for generation in &generations {
            assert!(!generation.is_current());
        }
    }
}
