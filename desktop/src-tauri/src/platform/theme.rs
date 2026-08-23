use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Theme, WebviewWindow};

const LIGHT_BACKGROUND: (u8, u8, u8) = (250, 250, 250);
const DARK_BACKGROUND: (u8, u8, u8) = (37, 37, 37);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppTheme {
    Light,
    Dark,
}

impl AppTheme {
    fn from_saved(value: &str) -> Option<Self> {
        match value.trim() {
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    fn native(self) -> Theme {
        match self {
            Self::Light => Theme::Light,
            Self::Dark => Theme::Dark,
        }
    }

    fn background(self) -> (u8, u8, u8) {
        match self {
            Self::Light => LIGHT_BACKGROUND,
            Self::Dark => DARK_BACKGROUND,
        }
    }
}

fn theme_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("theme"))
        .map_err(|error| format!("failed to resolve theme path: {error}"))
}

pub(crate) fn load_saved(app: &AppHandle) -> Result<Option<AppTheme>, String> {
    let path = theme_path(app)?;
    match fs::read_to_string(&path) {
        Ok(value) => match AppTheme::from_saved(&value) {
            Some(theme) => Ok(Some(theme)),
            None => {
                log::warn!("theme.saved_value_invalid path={}", path.display());
                Ok(None)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "failed to read saved theme at {}: {error}",
            path.display()
        )),
    }
}

fn system_theme(window: &WebviewWindow) -> AppTheme {
    match window.theme() {
        Ok(Theme::Dark) => AppTheme::Dark,
        Ok(_) => AppTheme::Light,
        Err(error) => {
            log::warn!("theme.system_read_failed error={error}; fallback=light");
            AppTheme::Light
        }
    }
}

fn paint(window: &WebviewWindow, theme: AppTheme) -> Result<(), String> {
    window
        .set_theme(Some(theme.native()))
        .map_err(|error| format!("failed to set native theme: {error}"))?;
    window
        .set_background_color(Some(theme.background().into()))
        .map_err(|error| format!("failed to set native background: {error}"))?;
    Ok(())
}

fn save(window: &WebviewWindow, theme: AppTheme) -> Result<(), String> {
    let path = theme_path(window.app_handle())?;
    let directory = path
        .parent()
        .ok_or_else(|| "theme path has no parent directory".to_owned())?;
    fs::create_dir_all(directory).map_err(|error| {
        format!(
            "failed to create theme directory {}: {error}",
            directory.display()
        )
    })?;
    fs::write(&path, theme.as_str())
        .map_err(|error| format!("failed to save theme at {}: {error}", path.display()))
}

pub fn initialize(window: &WebviewWindow) -> Result<AppTheme, String> {
    let saved = load_saved(window.app_handle())?;
    let theme = saved.unwrap_or_else(|| system_theme(window));
    paint(window, theme)?;
    log::info!(
        "theme.initialized theme={} source={}",
        theme.as_str(),
        if saved.is_some() { "saved" } else { "system" }
    );
    Ok(theme)
}

#[tauri::command]
pub fn apply_theme(window: WebviewWindow, theme: AppTheme) -> Result<(), String> {
    let result = paint(&window, theme).and_then(|()| save(&window, theme));
    match &result {
        Ok(()) => log::info!("theme.applied theme={}", theme.as_str()),
        Err(error) => log::error!("theme.apply_failed theme={} error={error}", theme.as_str()),
    }
    result
}
