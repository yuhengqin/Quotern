use crate::{host, sidecar, Sidecar};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    status: Mutex<Option<Value>>,
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    operation: tokio::sync::Mutex<()>,
}

fn public_key() -> Option<&'static str> {
    option_env!("QUOTERN_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty())
}
fn enabled() -> bool {
    public_key().is_some()
        && !cfg!(debug_assertions)
        && std::env::var_os("PORTABLE_EXECUTABLE_FILE").is_none()
        && (!cfg!(target_os = "macos") || option_env!("QUOTERN_MACOS_MODE") == Some("signed"))
}
fn marker(app: &AppHandle) -> Option<std::path::PathBuf> {
    sidecar::profile(app)
        .ok()
        .map(|p| p.join("installed-update-version"))
}
fn state(app: &AppHandle) -> Value {
    let data = app.state::<Updates>();
    let mut value = data.status.lock().unwrap().clone().unwrap_or_else(|| {
        json!({
            "currentVersion":app.package_info().version.to_string(),
            "status":if enabled() {"idle"} else {"manual"}
        })
    });
    if let Some(version) = marker(app).and_then(|p| std::fs::read_to_string(p).ok()) {
        if version == app.package_info().version.to_string() {
            value["completedVersion"] = json!(version);
        }
    }
    value
}
fn publish(app: &AppHandle, mut value: Value) -> Value {
    value["currentVersion"] = json!(app.package_info().version.to_string());
    *app.state::<Updates>().status.lock().unwrap() = Some(value.clone());
    host::desktop_event(
        app,
        "main",
        "auto-update:state-changed",
        json!([value.clone()]),
    );
    value
}

pub async fn handle(app: &AppHandle, channel: &str) -> Result<Value, String> {
    let updates = app.state::<Updates>();
    match channel {
        "auto-update:get-state" => return Ok(state(app)),
        "auto-update:ack-completed" => {
            if let Some(path) = marker(app) {
                match std::fs::remove_file(path) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.to_string()),
                }
            }
            return Ok(state(app));
        }
        _ => {}
    }
    if !enabled() {
        return Ok(state(app));
    }
    let Ok(_serial) = updates.operation.try_lock() else {
        return Ok(state(app));
    };
    if channel == "auto-update:check" {
        if updates.pending.lock().unwrap().is_some() {
            return Ok(state(app));
        }
        publish(app, json!({"status":"checking"}));
        match download(app).await {
            Ok(Some((update, bytes))) => {
                let version = update.version.clone();
                *updates.pending.lock().unwrap() = Some((update, bytes));
                Ok(publish(
                    app,
                    json!({"status":"downloaded","version":version}),
                ))
            }
            Ok(None) => Ok(publish(app, json!({"status":"not-available"}))),
            Err(_) => Ok(publish(app, json!({"status":"error"}))),
        }
    } else if channel == "auto-update:install" {
        let pending = updates.pending.lock().unwrap().take();
        let Some((update, bytes)) = pending else {
            return Ok(state(app));
        };
        let version = update.version.clone();
        let path = marker(app).ok_or("Missing update marker directory")?;
        if let Err(e) = std::fs::write(&path, &version) {
            *updates.pending.lock().unwrap() = Some((update, bytes));
            return Err(e.to_string());
        }
        publish(app, json!({"status":"installing","version":version}));
        // Windows exits from inside the installer. Retire the data owner first.
        app.state::<Sidecar>().shutdown().await;
        match update.install(&bytes) {
            Ok(()) => app.restart(),
            Err(_) => {
                let _ = std::fs::remove_file(path);
                app.state::<Sidecar>().resume();
                let _ = app.state::<Sidecar>().start(app).await;
                *updates.pending.lock().unwrap() = Some((update, bytes));
                Ok(publish(
                    app,
                    json!({"status":"downloaded","version":version}),
                ))
            }
        }
    } else {
        Err("Unknown update operation".into())
    }
}

async fn download(
    app: &AppHandle,
) -> Result<Option<(Update, Vec<u8>)>, Box<dyn std::error::Error + Send + Sync>> {
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else {
        "darwin"
    };
    let arch = std::env::consts::ARCH;
    let endpoint=Url::parse(&format!("https://github.com/yuhengqin/Quotern/releases/latest/download/tauri-{platform}-{arch}.json"))?;
    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])?
        .pubkey(public_key().unwrap())
        .timeout(Duration::from_secs(60));
    if let Ok(token) = std::env::var("GH_TOKEN").or_else(|_| std::env::var("GITHUB_TOKEN")) {
        builder = builder.header("Authorization", format!("Bearer {token}"))?;
    }
    let Some(update) = builder.build()?.check().await? else {
        return Ok(None);
    };
    let version = update.version.clone();
    let mut transferred = 0usize;
    let mut previous = std::time::Instant::now();
    publish(app, json!({"status":"downloading","version":version}));
    let bytes=update.download(|length,total|{
        transferred+=length;
        if previous.elapsed()>=Duration::from_millis(250){
            publish(app,json!({"status":"downloading","version":version,"transferred":transferred,"total":total,
                "percent":total.filter(|n|*n>0).map(|n|transferred as f64*100./n as f64)}));
            previous=std::time::Instant::now();
        }
    },||{}).await?;
    Ok(Some((update, bytes)))
}
pub fn schedule(app: AppHandle) {
    if !enabled() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            let _ = handle(&app, "auto-update:check").await;
            tokio::time::sleep(Duration::from_secs(4 * 60 * 60)).await;
        }
    });
}
