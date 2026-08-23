mod app;
mod sidecar;

#[cfg(target_os = "macos")]
pub(crate) mod audio;
#[cfg(target_os = "macos")]
mod platform;

pub use app::run;
