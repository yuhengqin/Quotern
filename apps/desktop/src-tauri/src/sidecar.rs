use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{oneshot, watch, Mutex as AsyncMutex},
    time::timeout,
};

const MAX_FRAME: usize = 64 * 1024 * 1024;
type Reply = Result<Value, String>;

struct Session {
    input: AsyncMutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    closed: AtomicBool,
    exit: watch::Receiver<bool>,
    stop: watch::Sender<bool>,
}

impl Session {
    fn disconnect(&self) {
        self.closed.store(true, Ordering::SeqCst);
        for (_, caller) in self.pending.lock().unwrap().drain() {
            let _ = caller.send(Err("Quotern runtime disconnected".into()));
        }
    }
}

pub struct Sidecar {
    current: AsyncMutex<Option<Arc<Session>>>,
    next_id: AtomicU64,
    stopping: AtomicBool,
}

impl Default for Sidecar {
    fn default() -> Self {
        Self {
            current: AsyncMutex::new(None),
            next_id: AtomicU64::new(1),
            stopping: AtomicBool::new(false),
        }
    }
}

fn private_profile(app: &AppHandle) -> Result<PathBuf, String> {
    if std::env::var_os("QUOTERN_DEV_ISOLATED").as_deref() == Some("1".as_ref()) {
        let profile = std::env::var_os("QUOTERN_DESKTOP_USER_DATA")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .ok_or("Missing isolated desktop profile")?;
        for variable in ["QUOTERN_DATA_DIR", "QUOTERN_CONFIG_HOME"] {
            if !std::env::var_os(variable)
                .map(PathBuf::from)
                .is_some_and(|p| p.is_absolute())
            {
                return Err(format!("Missing isolated {variable}"));
            }
        }
        return Ok(profile);
    }
    let name = if cfg!(debug_assertions) {
        "quotern-desktop"
    } else {
        "Quotern"
    };
    let dir = app.path().config_dir().map_err(|e| e.to_string())?;
    let preferred = dir.join(name);
    let other = dir.join(if name == "Quotern" {
        "quotern-desktop"
    } else {
        "Quotern"
    });
    let has_preferences = |p: &Path| {
        [
            "desktop-prefs.json",
            "appearance.json",
            "pet-settings.json",
            "quota",
        ]
        .iter()
        .any(|file| p.join(file).exists())
    };
    Ok(if !has_preferences(&preferred) && has_preferences(&other) {
        other
    } else {
        preferred
    })
}

pub fn profile(app: &AppHandle) -> Result<PathBuf, String> {
    private_profile(app)
}

async fn read_frames(app: AppHandle, output: tokio::process::ChildStdout, session: Arc<Session>) {
    let mut output = BufReader::new(output);
    let mut frame = Vec::new();
    loop {
        frame.clear();
        let read = (&mut output)
            .take(MAX_FRAME as u64 + 1)
            .read_until(b'\n', &mut frame)
            .await;
        if !matches!(read, Ok(n) if n > 0 && n <= MAX_FRAME) || frame.last() != Some(&b'\n') {
            break;
        }
        let message: Value = match serde_json::from_slice(&frame) {
            Ok(v) => v,
            Err(_) => break,
        };
        match message.get("type").and_then(Value::as_str) {
            Some("reply") => {
                if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    if let Some(caller) = session.pending.lock().unwrap().remove(&id) {
                        let reply = match message.get("error").and_then(Value::as_str) {
                            Some(error) => Err(error.to_owned()),
                            None => Ok(message.get("value").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = caller.send(reply);
                    }
                }
            }
            Some("native") => {
                let Some(id) = message["id"].as_u64() else {
                    break;
                };
                let app = app.clone();
                let session = session.clone();
                tauri::async_runtime::spawn(async move {
                    let result = crate::native_operation(&app, &message).await;
                    let reply = match result {
                        Ok(value) => json!({"type":"native-reply","id":id,"value":value}),
                        Err(error) => json!({"type":"native-reply","id":id,"error":error}),
                    };
                    if let Ok(mut frame) = serde_json::to_vec(&reply) {
                        frame.push(b'\n');
                        let _ = session.input.lock().await.write_all(&frame).await;
                    }
                });
            }
            Some("event") => {
                let Some(channel) = message.get("channel").and_then(Value::as_str) else {
                    break;
                };
                let Some(args) = message.get("args").and_then(Value::as_array) else {
                    break;
                };
                let payload = json!({"channel":channel, "args":args});
                if matches!(
                    channel,
                    "locale:changed"
                        | "autostart:changed"
                        | "pet:selection:state"
                        | "tray-usage:changed"
                        | "tray-usage-mode:changed"
                        | "quota:changed"
                        | "tud:data-synced"
                ) {
                    crate::tray_menu::refresh(&app);
                }
                if let Some(label) = message.get("window").and_then(Value::as_str) {
                    let _ = app.emit_to(label, "desktop-event", &payload);
                } else {
                    for label in app.webview_windows().keys() {
                        let receives = match label.as_str() {
                            "pet" => matches!(channel, "pet:state" | "pet:event"),
                            "dsh-pet" => matches!(
                                channel,
                                "pet:idle"
                                    | "pet:cursor-position"
                                    | "pet:displays"
                                    | "pet:hit"
                                    | "pet:flight-states"
                            ),
                            _ => true,
                        };
                        if receives {
                            let _ = app.emit_to(label.as_str(), "desktop-event", &payload);
                        }
                    }
                }
            }
            _ => break,
        }
    }
    session.disconnect();
    let _ = session.stop.send(true);
}

pub fn runtime_files(app: Option<&AppHandle>) -> Result<(PathBuf, PathBuf), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let node = executable
        .parent()
        .ok_or("Missing application directory")?
        .join(format!("quotern-node{}", std::env::consts::EXE_SUFFIX));
    let base = executable.parent().ok_or("Missing application directory")?;
    let dir = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../out/sidecar")
    } else if let Some(dir) = app
        .and_then(|a| a.path().resource_dir().ok())
        .map(|p| p.join("node"))
        .filter(|p| p.join("quotern-desktop-runtime.cjs").is_file())
    {
        dir
    } else {
        base.join("node")
    };
    Ok((node, dir))
}

fn spawn(app: &AppHandle) -> Result<Arc<Session>, String> {
    let (node, directory) = runtime_files(Some(app))?;
    let script = directory.join("quotern-desktop-runtime.cjs");
    if !node.is_file() || !script.is_file() {
        return Err("Packaged Quotern Node runtime is missing".into());
    }
    let script = script.canonicalize().map_err(|e| e.to_string())?;
    let mut command = Command::new(node);
    command
        .arg(&script)
        .current_dir(script.parent().unwrap())
        .env("QUOTERN_DESKTOP_USER_DATA", private_profile(app)?)
        .env(
            "QUOTERN_DESKTOP_EXECUTABLE",
            std::env::current_exe().map_err(|e| e.to_string())?,
        )
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start Quotern runtime: {e}"))?;
    let input = child.stdin.take().ok_or("Missing Node input")?;
    let output = child.stdout.take().ok_or("Missing Node output")?;
    let (exited, exit) = watch::channel(false);
    let (stop, mut stopping) = watch::channel(false);
    let session = Arc::new(Session {
        input: AsyncMutex::new(input),
        pending: Mutex::new(HashMap::new()),
        closed: AtomicBool::new(false),
        exit,
        stop,
    });
    tauri::async_runtime::spawn(read_frames(app.clone(), output, session.clone()));
    let running = session.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = child.wait() => {},
            _ = stopping.changed() => {
                if timeout(Duration::from_secs(8), child.wait()).await.is_err() {
                    let _ = child.kill().await;
                }
            }
        }
        running.disconnect();
        let _ = exited.send(true);
    });
    Ok(session)
}

impl Sidecar {
    pub fn resume(&self) {
        self.stopping.store(false, Ordering::SeqCst);
    }
    async fn session(&self, app: &AppHandle) -> Result<Arc<Session>, String> {
        let mut current = self.current.lock().await;
        if self.stopping.load(Ordering::SeqCst) {
            return Err("Quotern is quitting".into());
        }
        if let Some(session) = current.as_ref() {
            if !session.closed.load(Ordering::SeqCst) {
                return Ok(session.clone());
            }
            if !*session.exit.borrow() {
                return Err("Quotern runtime is recovering".into());
            }
        }
        let session = spawn(app)?;
        *current = Some(session.clone());
        Ok(session)
    }

    pub async fn start(&self, app: &AppHandle) -> Result<(), String> {
        self.session(app).await.map(|_| ())
    }

    pub async fn request(
        &self,
        app: &AppHandle,
        window: &str,
        channel: &str,
        args: Vec<Value>,
    ) -> Reply {
        let running = self.session(app).await?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut frame =
            serde_json::to_vec(&json!({"id":id,"window":window,"channel":channel,"args":args}))
                .map_err(|e| e.to_string())?;
        if frame.len() >= MAX_FRAME {
            return Err("Desktop request is too large".into());
        }
        frame.push(b'\n');
        let (send, response) = oneshot::channel();
        {
            let mut pending = running.pending.lock().unwrap();
            if running.closed.load(Ordering::SeqCst) {
                return Err("Quotern runtime disconnected".into());
            }
            if pending.len() >= 128 {
                return Err("Too many concurrent desktop requests".into());
            }
            pending.insert(id, send);
        }
        let operation = async {
            running
                .input
                .lock()
                .await
                .write_all(&frame)
                .await
                .map_err(|e| e.to_string())?;
            response
                .await
                .map_err(|_| "Quotern runtime disconnected".to_owned())?
        };
        let result = timeout(Duration::from_secs(630), operation).await;
        running.pending.lock().unwrap().remove(&id);
        result.map_err(|_| "Quotern runtime request timed out".to_owned())?
    }

    pub async fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        let Some(running) = self.current.lock().await.take() else {
            return;
        };
        // Windows anonymous pipes may remain open after AsyncWrite::shutdown.
        // Tell the child to release its PID lease before the host exits.
        let _ = running.stop.send(true);
        let _ = timeout(Duration::from_secs(2), async {
            let mut input = running.input.lock().await;
            let _ = input.write_all(b"{\"type\":\"shutdown\"}\n").await;
            let _ = input.shutdown().await;
        })
        .await;
        let mut exit = running.exit.clone();
        let _ = timeout(Duration::from_secs(12), exit.wait_for(|v| *v)).await;
    }
}
