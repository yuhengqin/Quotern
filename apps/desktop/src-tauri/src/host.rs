use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
#[cfg(not(any(windows, target_os = "macos")))]
use tauri_plugin_notification::{Action, ActionType, NotificationExt};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct HostState {
    pub chrome: Mutex<Option<(tauri::window::Color, Option<tauri::Theme>)>>,
    pub references: Mutex<HashMap<String, String>>,
    pub settings: Mutex<Option<Value>>,
    pub quota: Mutex<Option<Value>>,
    pub dialog: std::sync::atomic::AtomicBool,
    pub shortcut: tokio::sync::Mutex<String>,
    pub notices: Mutex<HashMap<i32, String>>,
    pub seq: AtomicU32,
    pub pet_menu: Mutex<Option<(String, tokio::sync::oneshot::Sender<String>)>>,
}
pub fn desktop_event(app: &AppHandle, label: &str, channel: &str, args: Value) {
    let _ = app.emit_to(
        label,
        "desktop-event",
        json!({"channel":channel,"args":args}),
    );
}

pub fn open_settings(app: &AppHandle, detail: Value) -> Result<(), String> {
    let state = app.state::<HostState>();
    let request_id = state.seq.fetch_add(1, Ordering::Relaxed);
    *state.settings.lock().unwrap() = Some(json!({"requestId": request_id, "detail": detail}));
    super::show(app, "main").map_err(|e| e.to_string())?;
    desktop_event(app, "main", "app:open-settings", json!([]));
    Ok(())
}
pub fn notification_actions(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        super::macos_notices::register(app);
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let handle = app.clone();
        app.notification()
            .register_action_types(vec![ActionType::builder("quota")
                .actions(vec![
                    Action::builder("view", "Open").build(),
                    Action::builder("snooze", "Snooze").build(),
                    Action::builder("dismiss-all", "Dismiss all").build(),
                ])
                .build()])
            .map_err(|e| e.to_string())?;
        app.notification()
            .on_action(move |action| {
                let id = action.notification().and_then(|n| {
                    handle
                        .state::<HostState>()
                        .notices
                        .lock()
                        .unwrap()
                        .get(&n.id())
                        .cloned()
                });
                if let Some(id) = id {
                    let app = handle.clone();
                    let verb = match action.action_id() {
                        "snooze" => "snooze",
                        "dismiss-all" => "dismiss-all",
                        _ => "view",
                    };
                    tauri::async_runtime::spawn(async move {
                        let _ = app
                            .state::<super::Sidecar>()
                            .request(
                                &app,
                                "host",
                                "notifications:activate",
                                vec![json!(id), json!(verb)],
                            )
                            .await;
                    });
                }
            })
            .map_err(|e| e.to_string())
    }
}
pub async fn operation(app: &AppHandle, message: &Value) -> Result<Value, String> {
    let a = &message["args"];
    let channel = message["channel"]
        .as_str()
        .ok_or("Missing native operation")?;
    let state = app.state::<HostState>();
    match channel {
        "host:quota-session-unlocked" => {
            let unlocked = tauri::async_runtime::spawn_blocking(crate::session_state::is_unlocked)
                .await
                .map_err(|error| error.to_string())?;
            return Ok(json!(unlocked));
        }
        "host:chrome" => {
            let hex = a[0]["background"]
                .as_str()
                .and_then(|s| s.strip_prefix('#'))
                .filter(|s| s.len() == 6)
                .ok_or("Invalid chrome color")?;
            let rgb = u32::from_str_radix(hex, 16).map_err(|_| "Invalid chrome color")?;
            let color = tauri::window::Color((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8, 255);
            let theme = match a[0]["mode"].as_str() {
                Some("light") => Some(tauri::Theme::Light),
                Some("dark") => Some(tauri::Theme::Dark),
                _ => None,
            };
            *state.chrome.lock().unwrap() = Some((color, theme));
            for (label, w) in app.webview_windows() {
                if !matches!(label.as_str(), "pet" | "dsh-pet") {
                    let _ = w.set_background_color(Some(color));
                    let _ = w.set_theme(theme);
                }
            }
        }
        "host:open-main" => super::show(app, "main").map_err(|e| e.to_string())?,
        "host:open-quota" => {
            if let Some(mut target) = a[0].as_object().cloned() {
                target.insert(
                    "requestId".into(),
                    json!(state.seq.fetch_add(1, Ordering::Relaxed).to_string()),
                );
                *state.quota.lock().unwrap() = Some(Value::Object(target));
            }
            super::show(app, "tray").map_err(|e| e.to_string())?;
            desktop_event(app, "tray", "quota:navigation", json!([]));
        }
        "host:settings" => {
            let detail = if a[0].is_object() {
                json!({"tab":"pet","pet":{"requestId":state.seq.fetch_add(1,Ordering::Relaxed).to_string(),"target":a[0]}})
            } else {
                json!({"tab":"pet"})
            };
            open_settings(app, detail)?;
        }
        "host:fish-directory" => {
            app.opener()
                .open_path(
                    super::sidecar::profile(app)?
                        .join("dsh-pet")
                        .to_string_lossy()
                        .as_ref(),
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?;
        }
        "host:pick-pet" => {
            let (send, recv) = tokio::sync::oneshot::channel();
            app.dialog()
                .file()
                .add_filter("Pet ZIP", &["zip"])
                .pick_file(move |file| {
                    let _ = send.send(file.and_then(|p| p.into_path().ok()));
                });
            return Ok(json!(recv.await.map_err(|e| e.to_string())?));
        }
        "pet:window" | "dsh:window" => {
            super::pet_window::set_window(
                app,
                channel == "dsh:window",
                a[0].as_bool().ok_or("Invalid pet visibility")?,
                &a[1],
                a[2].as_u64().unwrap_or_default(),
            )
            .await?
        }
        "notifications:show" => {
            let notice = &a[0];
            let id = state.seq.fetch_add(1, Ordering::Relaxed) as i32;
            let key = notice["id"].as_str().ok_or("Missing notification id")?;
            state.notices.lock().unwrap().insert(id, key.to_owned());
            #[cfg(windows)]
            let delivery = windows_show(id, &a[1]);
            #[cfg(target_os = "macos")]
            let delivery = super::macos_notices::show(notice).await;
            #[cfg(not(any(windows, target_os = "macos")))]
            let delivery = app
                .notification()
                .builder()
                .id(id)
                .title(notice["title"].as_str().unwrap_or("Quotern"))
                .body(notice["body"].as_str().unwrap_or(""))
                .action_type_id("quota")
                .silent()
                .show()
                .map_err(|e| e.to_string());
            if let Err(e) = delivery {
                state.notices.lock().unwrap().remove(&id);
                return Err(e.to_string());
            }
            return Ok(json!("shown"));
        }
        "notifications:remove" => {
            let key = a[0].as_str().ok_or("Missing notification id")?;
            let id = {
                let mut entries = state.notices.lock().unwrap();
                let id = entries
                    .iter()
                    .find(|(_, s)| s.as_str() == key)
                    .map(|(id, _)| *id);
                if let Some(id) = id {
                    entries.remove(&id);
                }
                id
            };
            if let Some(id) = id {
                #[cfg(windows)]
                windows_remove(id, a[1].as_str().ok_or("Missing notification app ID")?)?;
                #[cfg(target_os = "macos")]
                super::macos_notices::remove(key)?;
                #[cfg(not(any(windows, target_os = "macos")))]
                app.notification()
                    .remove_active(vec![id])
                    .map_err(|e| e.to_string())?;
            }
        }
        _ => return Err(format!("Unknown native host operation: {channel}")),
    }
    Ok(Value::Null)
}

#[cfg(windows)]
fn windows_show(id: i32, options: &Value) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };
    let xml = options["toast"]
        .as_str()
        .ok_or("Missing notification XML")?;
    let app_id = HSTRING::from(
        options["appId"]
            .as_str()
            .ok_or("Missing notification app ID")?,
    );
    (|| -> windows::core::Result<()> {
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        toast.SetTag(&HSTRING::from(id.to_string()))?;
        toast.SetGroup(&HSTRING::from("Quotern"))?;
        ToastNotificationManager::CreateToastNotifierWithId(&app_id)?.Show(&toast)
    })()
    .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn windows_remove(id: i32, app_id: &str) -> Result<(), String> {
    use windows::{core::HSTRING, UI::Notifications::ToastNotificationManager};
    ToastNotificationManager::History()
        .and_then(|history| {
            history.RemoveGroupedTagWithId(
                &HSTRING::from(id.to_string()),
                &HSTRING::from("Quotern"),
                &HSTRING::from(app_id),
            )
        })
        .map_err(|e| e.to_string())
}
