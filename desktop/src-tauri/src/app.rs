use tauri::{Manager, RunEvent};

use crate::sidecar::SidecarState;

#[cfg(target_os = "macos")]
use crate::{audio, platform};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log_level)
                .max_file_size(1_000_000)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(setup);

    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        platform::theme::apply_theme,
        platform::permissions::open_system_settings,
        platform::window::set_window_mode,
        platform::permissions::check_permissions,
        platform::permissions::request_microphone_permission,
        platform::permissions::request_system_audio_permission,
        audio::start_mic_audio,
        audio::stop_mic_audio,
        audio::start_system_audio,
        audio::stop_system_audio,
    ]);

    builder
        .build(tauri::generate_context!())
        .expect("failed to build meetwrite")
        .run(handle_run_event);
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(SidecarState::start(app)?);

    #[cfg(target_os = "macos")]
    {
        platform::create_main_window(app)?;
        app.manage(audio::AudioState::new());
        app.manage(platform::window::WindowController::new());
        platform::prepare(app)?;
    }

    log::info!("app.ready");
    Ok(())
}

fn handle_run_event(app: &tauri::AppHandle, event: RunEvent) {
    if !matches!(event, RunEvent::Exit) {
        return;
    }

    log::info!("app.shutdown_started");
    #[cfg(target_os = "macos")]
    if let Some(audio) = app.try_state::<audio::AudioState>() {
        audio.shutdown();
    }
    if let Some(sidecar) = app.try_state::<SidecarState>() {
        sidecar.stop();
    }
    log::info!("app.shutdown_finished");
}
