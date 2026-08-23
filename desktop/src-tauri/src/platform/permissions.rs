use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use block2::RcBlock;
use core_graphics::access::ScreenCaptureAccess;
use objc2::runtime::Bool;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaType, AVMediaTypeAudio};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const MICROPHONE_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const SYSTEM_AUDIO_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SYSTEM_AUDIO_PROBE_INTERVAL: Duration = Duration::from_millis(500);
const SYSTEM_AUDIO_UNKNOWN: u8 = 0;
const SYSTEM_AUDIO_DENIED: u8 = 1;
const SYSTEM_AUDIO_GRANTED: u8 = 2;

static SYSTEM_AUDIO_OBSERVATION: AtomicU8 = AtomicU8::new(SYSTEM_AUDIO_UNKNOWN);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsStatus {
    pub microphone: PermissionState,
    pub system_audio: PermissionState,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingsPane {
    Microphone,
    ScreenCapture,
}

impl SettingsPane {
    fn anchor(self) -> &'static str {
        match self {
            Self::Microphone => "Privacy_Microphone",
            Self::ScreenCapture => "Privacy_ScreenCapture",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::ScreenCapture => "screenCapture",
        }
    }
}

fn microphone_media_type() -> Result<&'static AVMediaType, String> {
    // The framework constant is weak-linked and is therefore represented as an Option.
    unsafe { AVMediaTypeAudio }.ok_or_else(|| "microphone media type is unavailable".to_owned())
}

fn microphone_status() -> Result<PermissionState, String> {
    let media_type = microphone_media_type()?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };

    Ok(match status {
        AVAuthorizationStatus::Authorized => PermissionState::Granted,
        AVAuthorizationStatus::NotDetermined => PermissionState::NotDetermined,
        AVAuthorizationStatus::Denied | AVAuthorizationStatus::Restricted => {
            PermissionState::Denied
        }
        unknown => {
            log::warn!("permissions.microphone_unknown_status status={unknown:?}");
            PermissionState::Denied
        }
    })
}

fn system_audio_status() -> PermissionState {
    if ScreenCaptureAccess.preflight() {
        SYSTEM_AUDIO_OBSERVATION.store(SYSTEM_AUDIO_GRANTED, Ordering::Release);
        return PermissionState::Granted;
    }

    match SYSTEM_AUDIO_OBSERVATION.load(Ordering::Acquire) {
        SYSTEM_AUDIO_UNKNOWN => PermissionState::NotDetermined,
        SYSTEM_AUDIO_GRANTED => PermissionState::Granted,
        SYSTEM_AUDIO_DENIED => {
            // A previous request failed; the grant may have changed in System
            // Settings since. Probe the tap once more.
            if crate::audio::probe_system_audio().is_ok() {
                SYSTEM_AUDIO_OBSERVATION.store(SYSTEM_AUDIO_GRANTED, Ordering::Release);
                PermissionState::Granted
            } else {
                PermissionState::Denied
            }
        }
        _ => PermissionState::Denied,
    }
}

fn request_microphone_blocking() -> Result<bool, String> {
    match microphone_status()? {
        PermissionState::Granted => return Ok(true),
        PermissionState::Denied => return Ok(false),
        PermissionState::NotDetermined => {}
    }

    let media_type = microphone_media_type()?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let completion = RcBlock::new(move |granted: Bool| {
        let _ = sender.try_send(granted.as_bool());
    });

    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &completion);
    }

    receiver
        .recv_timeout(MICROPHONE_REQUEST_TIMEOUT)
        .map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => "microphone permission request timed out".to_owned(),
            mpsc::RecvTimeoutError::Disconnected => {
                "microphone permission callback disconnected".to_owned()
            }
        })
}

async fn run_blocking<T, F>(operation: &'static str, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("{operation} worker failed: {error}"))?
}

#[tauri::command]
pub async fn check_permissions() -> Result<PermissionsStatus, String> {
    let result = run_blocking("permission check", || {
        Ok(PermissionsStatus {
            microphone: microphone_status()?,
            system_audio: system_audio_status(),
        })
    })
    .await;

    match &result {
        Ok(status) => log::debug!(
            "permissions.checked microphone={:?} system_audio={:?}",
            status.microphone,
            status.system_audio
        ),
        Err(error) => log::error!("permissions.check_failed error={error}"),
    }
    result
}

#[tauri::command]
pub async fn request_microphone_permission() -> Result<bool, String> {
    let result = run_blocking("microphone permission request", request_microphone_blocking).await;
    match &result {
        Ok(granted) => log::info!("permissions.microphone_requested granted={granted}"),
        Err(error) => log::error!("permissions.microphone_request_failed error={error}"),
    }
    result
}

#[tauri::command]
pub async fn request_system_audio_permission() -> Result<bool, String> {
    let result = run_blocking("system audio permission request", || {
        // macOS has no API to request system-audio capture alone. Creating the
        // CoreAudio process tap is what raises the audio-only Audio Capture
        // prompt (macOS 14.2+), so probe until the grant lands or we time out.
        let deadline = Instant::now() + SYSTEM_AUDIO_REQUEST_TIMEOUT;
        loop {
            match crate::audio::probe_system_audio() {
                Ok(()) => {
                    SYSTEM_AUDIO_OBSERVATION.store(SYSTEM_AUDIO_GRANTED, Ordering::Release);
                    return Ok(true);
                }
                Err(error) => {
                    log::debug!("permissions.system_audio_probe_pending error={error}");
                    if Instant::now() >= deadline {
                        SYSTEM_AUDIO_OBSERVATION.store(SYSTEM_AUDIO_DENIED, Ordering::Release);
                        return Ok(false);
                    }
                    thread::sleep(SYSTEM_AUDIO_PROBE_INTERVAL);
                }
            }
        }
    })
    .await;

    match &result {
        Ok(granted) => log::info!("permissions.system_audio_requested granted={granted}"),
        Err(error) => log::error!("permissions.system_audio_request_failed error={error}"),
    }
    result
}

#[tauri::command]
pub fn open_system_settings(app: AppHandle, pane: SettingsPane) -> Result<(), String> {
    let url = format!(
        "x-apple.systempreferences:com.apple.preference.security?{}",
        pane.anchor()
    );
    let result = app
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("failed to open System Settings: {error}"));

    match &result {
        Ok(()) => log::info!("permissions.settings_opened pane={}", pane.as_str()),
        Err(error) => log::error!(
            "permissions.settings_open_failed pane={} error={error}",
            pane.as_str()
        ),
    }
    result
}
