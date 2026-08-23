pub mod permissions;
pub mod theme;
pub mod window;

use std::error::Error;
use std::io;

use tauri::{Manager, WebviewWindowBuilder};

/// The main window is created here — not by the config's create-by-default
/// path — so the shell can inject the saved theme as an initialization
/// script. It runs at document start, before the page's own scripts, so the
/// very first webview frame already matches the theme the native window was
/// painted with: no light flash between the two. Without a saved file the
/// webview's own system-appearance fallback agrees with the native paint.
pub fn create_main_window(app: &tauri::App) -> Result<(), Box<dyn Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or_else(|| io::Error::other("main window config is unavailable"))?;
    let mut builder = WebviewWindowBuilder::from_config(app.handle(), config)?;
    if let Some(theme) = theme::load_saved(app.handle())? {
        builder = builder.initialization_script(format!(
            "(function(){{try{{document.documentElement.dataset.theme='{}';}}catch(error){{}}}})();",
            theme.as_str()
        ));
        log::info!("window.theme_script_injected theme={}", theme.as_str());
    }
    builder.build().map_err(io::Error::other)?;
    log::info!("window.created");
    Ok(())
}

pub fn prepare(app: &tauri::App) -> Result<(), Box<dyn Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| io::Error::other("main window is unavailable"))?;

    window::configure_native_window(&window).map_err(io::Error::other)?;
    theme::initialize(&window).map_err(io::Error::other)?;
    window.show()?;

    log::info!("platform.prepared");
    Ok(())
}
