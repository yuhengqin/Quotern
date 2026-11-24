use crate::{host, Sidecar};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Manager, Wry,
};
struct Tray {
    main: MenuItem<Wry>,
    login: CheckMenuItem<Wry>,
    pet: Option<CheckMenuItem<Wry>>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    generation: AtomicU64,
    saving: tokio::sync::Mutex<()>,
}
pub fn create(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let main = MenuItem::with_id(app, "open", "Quotern", true, None::<&str>)?;
    let login = CheckMenuItem::with_id(app, "login", "Open at login", true, false, None::<&str>)?;
    let pet = if cfg!(windows) {
        Some(CheckMenuItem::with_id(
            app,
            "tray-pet",
            "Desktop pet",
            true,
            false,
            None::<&str>,
        )?)
    } else {
        None
    };
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&main, &login])?;
    if let Some(item) = &pet {
        menu.append(item)?;
    }
    menu.append(&settings)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&quit)?;
    app.manage(Tray {
        main,
        login,
        pet,
        settings,
        quit,
        generation: AtomicU64::new(0),
        saving: tokio::sync::Mutex::new(()),
    });
    Ok(menu)
}
pub async fn save_login(app: &AppHandle, enabled: bool) -> Result<Value, String> {
    let state = app.state::<Tray>();
    let _saving = state.saving.lock().await;
    let sidecar = app.state::<Sidecar>();
    let old = sidecar
        .request(app, "host", "autostart:get", vec![])
        .await?
        .as_bool()
        .unwrap_or(true);
    super::apply_autostart(app, enabled)?;
    let result = sidecar
        .request(app, "host", "autostart:save", vec![json!(enabled)])
        .await;
    if result.is_err() {
        super::apply_autostart(app, old)?;
    }
    result
}
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let seq = tray.generation.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
        let state = app.state::<Tray>();
        if state.generation.load(Ordering::Relaxed) != seq {
            return;
        }
        let Ok(model) = app
            .state::<Sidecar>()
            .request(&app, "host", "runtime:tray-info", vec![])
            .await
        else {
            return;
        };
        if state.generation.load(Ordering::Relaxed) != seq {
            return;
        }
        let labels = &model["labels"];
        if let Some(label) = labels[0].as_str() {
            let _ = state.main.set_text(label);
        }
        if let Some(label) = labels[1].as_str() {
            let _ = state.login.set_text(label);
        }
        if let Some(label) = labels[3].as_str() {
            let _ = state.settings.set_text(label);
        }
        if let Some(label) = labels[4].as_str() {
            let _ = state.quit.set_text(label);
        }
        let _ = state.login.set_checked(model["login"] == true);
        if let Some(item) = &state.pet {
            if let Some(label) = labels[2].as_str() {
                let _ = item.set_text(label);
            }
            let _ = item.set_checked(model["pet"] == true);
        }
        if let Some(tray) = app.tray_by_id("quotern") {
            let _ = tray.set_tooltip(model["tooltip"].as_str());
            #[cfg(target_os = "macos")]
            let _ = tray.set_title(model["title"].as_str());
        }
    });
}
pub fn activate(app: &AppHandle, id: &str) {
    match id {
        "open" => {
            super::show_from_event(app, "main");
        }
        "quit" => super::quit(app),
        "settings" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = host::open_settings(&app, json!({})) {
                    eprintln!("Could not open settings: {error}");
                }
            });
        }
        "login" | "tray-pet" => {
            let login = id == "login";
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let controls = app.state::<Tray>();
                let result = if login {
                    save_login(&app, controls.login.is_checked().unwrap_or(false)).await
                } else {
                    let enabled = controls
                        .pet
                        .as_ref()
                        .is_some_and(|p| p.is_checked().unwrap_or(false));
                    app.state::<Sidecar>()
                        .request(&app, "host", "pet:enable", vec![json!(enabled)])
                        .await
                };
                if let Err(e) = result {
                    eprintln!("Quotern tray: {e}");
                }
                refresh(&app);
            });
        }
        _ => {}
    }
}
