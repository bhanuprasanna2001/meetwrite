#[cfg(not(debug_assertions))]
use std::{
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
const SIDECAR_ADDRESS: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8321);
#[cfg(not(debug_assertions))]
const SIDECAR_STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(not(debug_assertions))]
const SIDECAR_RETRY_INTERVAL: Duration = Duration::from_millis(50);
#[cfg(not(debug_assertions))]
const SIDECAR_IO_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct SidecarState {
    #[cfg(not(debug_assertions))]
    child: Mutex<Option<CommandChild>>,
    #[cfg(not(debug_assertions))]
    monitor: Mutex<Option<JoinHandle<()>>>,
}

impl SidecarState {
    #[cfg(debug_assertions)]
    pub fn start(_app: &tauri::App) -> Result<Self, Box<dyn std::error::Error>> {
        log::info!("sidecar.external mode=development");
        Ok(Self::default())
    }

    #[cfg(not(debug_assertions))]
    pub fn start(app: &tauri::App) -> Result<Self, Box<dyn std::error::Error>> {
        let port_guard = TcpListener::bind(SIDECAR_ADDRESS).map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::AddrInUse,
                format!("sidecar address {SIDECAR_ADDRESS} is unavailable ({error})"),
            )
        })?;

        let data_dir = app.path().app_data_dir()?;
        let audio_dir = data_dir.join("audio");
        std::fs::create_dir_all(&audio_dir)?;

        drop(port_guard);
        let (mut events, child) = app
            .shell()
            .sidecar("meetwrite-sidecar")?
            .env(
                "MEETWRITE_DATABASE_URL",
                format!("sqlite:///{}", data_dir.join("meetwrite.db").display()),
            )
            .env("MEETWRITE_AUDIO_DIR", audio_dir.display().to_string())
            .spawn()?;
        let pid = child.pid();
        let (terminated_tx, terminated_rx) = mpsc::sync_channel(1);

        let monitor = thread::Builder::new()
            .name("sidecar-events".to_string())
            .spawn(move || {
                while let Some(event) = events.blocking_recv() {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::debug!("sidecar.stdout bytes={}", line.len());
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("sidecar.stderr bytes={}", line.len());
                        }
                        CommandEvent::Error(error) => {
                            log::error!("sidecar.stream_failed error={error}");
                        }
                        CommandEvent::Terminated(status) => {
                            log::info!("sidecar.terminated status={status:?}");
                            let _ = terminated_tx.try_send(format!("{status:?}"));
                            break;
                        }
                        _ => {}
                    }
                }
            });
        let monitor = match monitor {
            Ok(monitor) => monitor,
            Err(error) => {
                if let Err(kill_error) = child.kill() {
                    log::error!(
                        "sidecar.monitor_start_failed pid={pid} error={error} kill_error={kill_error}"
                    );
                }
                return Err(Box::new(error));
            }
        };

        let startup = Instant::now();
        if let Err(error) = wait_until_ready(&terminated_rx) {
            let killed = match child.kill() {
                Ok(()) => true,
                Err(kill_error) => {
                    log::error!("sidecar.startup_cleanup_failed pid={pid} error={kill_error}");
                    false
                }
            };
            if killed && monitor.join().is_err() {
                log::error!("sidecar.monitor_panicked");
            }
            return Err(std::io::Error::other(error).into());
        }

        log::info!(
            "sidecar.started pid={pid} startup_ms={}",
            startup.elapsed().as_millis()
        );
        Ok(Self {
            child: Mutex::new(Some(child)),
            monitor: Mutex::new(Some(monitor)),
        })
    }

    pub fn stop(&self) {
        #[cfg(not(debug_assertions))]
        {
            let child = self
                .child
                .lock()
                .unwrap_or_else(|error| {
                    log::error!("sidecar.state_lock_recovered");
                    error.into_inner()
                })
                .take();
            let join_monitor = if let Some(child) = child {
                let pid = child.pid();
                match child.kill() {
                    Ok(()) => {
                        log::info!("sidecar.stopped pid={pid}");
                        true
                    }
                    Err(error) => {
                        log::error!("sidecar.stop_failed pid={pid} error={error}");
                        false
                    }
                }
            } else {
                true
            };
            let monitor = self
                .monitor
                .lock()
                .unwrap_or_else(|error| {
                    log::error!("sidecar.monitor_lock_recovered");
                    error.into_inner()
                })
                .take();
            if join_monitor {
                if monitor.is_some_and(|thread| thread.join().is_err()) {
                    log::error!("sidecar.monitor_panicked");
                }
            } else {
                drop(monitor);
            }
        }
    }
}

#[cfg(not(debug_assertions))]
fn wait_until_ready(terminated: &mpsc::Receiver<String>) -> Result<(), String> {
    let deadline = Instant::now() + SIDECAR_STARTUP_TIMEOUT;
    loop {
        match terminated.try_recv() {
            Ok(status) => return Err(format!("sidecar terminated during startup ({status})")),
            Err(mpsc::TryRecvError::Disconnected) => {
                return Err("sidecar monitor disconnected during startup".to_string());
            }
            Err(mpsc::TryRecvError::Empty) => {}
        }

        if health_check() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "sidecar did not become healthy within {} seconds",
                SIDECAR_STARTUP_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(SIDECAR_RETRY_INTERVAL);
    }
}

#[cfg(not(debug_assertions))]
fn health_check() -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&SIDECAR_ADDRESS, SIDECAR_IO_TIMEOUT) else {
        return false;
    };
    if stream.set_read_timeout(Some(SIDECAR_IO_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(SIDECAR_IO_TIMEOUT)).is_err()
        || stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:8321\r\nConnection: close\r\n\r\n")
            .is_err()
    {
        return false;
    }

    let mut response = String::new();
    if stream.take(4_096).read_to_string(&mut response).is_err() {
        return false;
    }
    healthy_response(&response)
}

#[cfg(any(not(debug_assertions), test))]
fn healthy_response(response: &str) -> bool {
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let status_ok = headers
        .lines()
        .next()
        .is_some_and(|status| status.starts_with("HTTP/1.1 200 "));
    status_ok && body.split_whitespace().collect::<String>() == r#"{"status":"ok"}"#
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::healthy_response;

    #[test]
    fn sidecar_readiness_requires_the_expected_health_response() {
        assert!(healthy_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\": \"ok\"}\n"
        ));
        assert!(!healthy_response(
            "HTTP/1.1 503 Service Unavailable\r\n\r\n{\"status\":\"ok\"}"
        ));
        assert!(!healthy_response(
            "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"starting\"}"
        ));
    }
}
