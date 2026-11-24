#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod host;
mod legacy_preferences;
#[cfg(target_os = "macos")]
mod macos_notices;
mod media;
mod pet_window;
mod popover;
mod resources;
mod sidecar;
mod tray_menu;
mod updates;
use base64::Engine;
use host::{operation as native_operation, HostState};
use serde_json::{json, Value};
use sidecar::Sidecar;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
#[cfg(not(windows))]
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

struct Quitting(AtomicBool);
fn platform_script() -> String {
    let platform = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    format!("Object.defineProperty(window,'__QUOTERN_PLATFORM__',{{value:'{platform}'}});")
}

fn local_url(app: &AppHandle, url: &tauri::Url) -> bool {
    if cfg!(debug_assertions) {
        if let Some(dev) = &app.config().build.dev_url {
            if url.origin() == dev.origin() {
                return true;
            }
        }
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
}

fn show_from_event(app: &AppHandle, label: &'static str) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = show(&handle, label) {
            eprintln!("Could not open {label}: {e}");
        }
    });
}

fn show(app: &AppHandle, label: &str) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(label) {
        window.show()?;
        window.unminimize()?;
        return window.set_focus();
    }
    let (page, width, height) = if label == "tray" {
        ("index.html?view=tray-popover", 446., 216.)
    } else {
        ("index.html", 1160., 780.)
    };
    let handle = app.clone();
    let opener = app.clone();
    let owner = label.to_owned();
    let profile = sidecar::profile(app).map_err(|e| std::io::Error::other(e))?;
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .title("Quotern")
        .inner_size(width, height)
        .visible(false)
        .initialization_script(platform_script())
        .data_directory(profile.join("webview"))
        .on_navigation(move |url| local_url(&handle, url))
        .on_new_window(move |url, _| handle_new_window(&opener, &owner, url));
    if label == "tray" {
        builder = builder
            .initialization_script("window.addEventListener('keydown', e=>{if(e.key==='Escape'&&!e.repeat&&!document.querySelector('[role=dialog],[role=listbox],[role=menu]')){void window.__TAURI_INTERNALS__.invoke('desktop_request',{channel:'tray-popover:hide',args:[]});}},true);")
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false);
    } else {
        builder = builder.min_inner_size(640., 400.);
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(12., 10.));
        }
        #[cfg(target_os = "linux")]
        {
            builder = builder.decorations(false);
        }
    }
    if let Some((color, theme)) = *app.state::<HostState>().chrome.lock().unwrap() {
        builder = builder.background_color(color).theme(theme);
    }
    let window = builder.build()?;
    if label == "tray" {
        popover::resize(app, 216.)?;
    }
    window.show()?;
    window.set_focus()
}

fn handle_new_window(
    app: &AppHandle,
    owner: &str,
    url: tauri::Url,
) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    if local_url(app, &url) {
        let kind = match (url.path(), url.fragment()) {
            ("/" | "/index.html", Some(f)) if f == "/pricing" || f.starts_with("/pricing?") => {
                Some("pricing")
            }
            ("/" | "/index.html", Some(f)) if f.starts_with("/sessions?") => Some("session"),
            _ => None,
        };
        if let Some(kind) = kind {
            let state = app.state::<HostState>();
            let name = format!("reference-{kind}-{}", state.seq.fetch_add(1, Ordering::Relaxed));
            // Record ownership before the asynchronous build so closing the
            // opener also cancels a reference that is still being created.
            state.references.lock().unwrap().insert(name.clone(), owner.to_owned());
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<HostState>();
                if !state.references.lock().unwrap().contains_key(&name) {
                    return;
                }
                let result = (|| -> tauri::Result<_> {
                    let profile = sidecar::profile(&app).map_err(std::io::Error::other)?;
                    let (handle, opener, parent) = (app.clone(), app.clone(), name.clone());
                    let mut builder = WebviewWindowBuilder::new(&app, &name, WebviewUrl::External(url))
                        .title("Quotern")
                        .inner_size(980., 720.)
                        .visible(false)
                        .data_directory(profile.join("webview"))
                        .initialization_script(platform_script())
                        .on_navigation(move |url| local_url(&handle, url))
                        .on_new_window(move |url, _| handle_new_window(&opener, &parent, url));
                    if let Some((color, theme)) = *state.chrome.lock().unwrap() {
                        builder = builder.background_color(color).theme(theme);
                    }
                    #[cfg(target_os = "macos")]
                    {
                        builder = builder
                            .title_bar_style(tauri::TitleBarStyle::Overlay)
                            .hidden_title(true);
                    }
                    #[cfg(target_os = "linux")]
                    {
                        builder = builder.decorations(false);
                    }
                    builder.build()
                })();
                let window = match result {
                    Ok(window) => window,
                    Err(error) => {
                        state.references.lock().unwrap().remove(&name);
                        eprintln!("[quotern-desktop] Could not create reference window: {error}");
                        return;
                    }
                };
                let still_owned = state.references.lock().unwrap().contains_key(&name);
                if still_owned {
                    if let Err(error) = window.show().and_then(|()| window.set_focus()) {
                        eprintln!("[quotern-desktop] Could not show reference window: {error}");
                    }
                } else {
                    let _ = window.destroy();
                }
            });
        }
    } else if matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
    {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    tauri::webview::NewWindowResponse::Deny
}

fn quit(app: &AppHandle) {
    if app.state::<Quitting>().0.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<Sidecar>().shutdown().await;
        app.exit(0);
    });
}

#[tauri::command]
async fn desktop_request(
    window: WebviewWindow,
    app: AppHandle,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    // The local-only capability and the fish window's navigation rule bind this
    // operation to Quotern. A URL query would wait on the modal menu's UI thread.
    #[cfg(windows)]
    if window.label() == "dsh-pet" && channel == "dsh:context-menu-close" && args.is_empty() {
        pet_window::cancel_menu(&app)?;
        return Ok(Value::Null);
    }
    if !local_url(&app, &window.url().map_err(|e| e.to_string())?)
        || args.len() > 8
        || channel.len() > 96
    {
        return Err("Invalid desktop request".into());
    }
    let ch = channel.as_str();
    let label = window.label();
    let value = args.first().unwrap_or(&Value::Null);
    let read = matches!(
        ch,
        "appearance:get"
            | "appearance:watch-visibility"
            | "appearance:unwatch-visibility"
            | "theme:get"
            | "theme:set"
            | "auto-update:get-state"
            | "appearance:initialize"
            | "locale:get"
            | "dashboard-range:get"
            | "quota:get"
            | "tud:api-request"
    );
    let allowed = match label {
        "main" => {
            !ch.starts_with("runtime:")
                && !matches!(
                    ch,
                    "autostart:save"
                        | "notifications:activate"
                        | "pet:hover"
                        | "pet:theme"
                        | "pet:placed"
                        | "pet:atlas"
                        | "pet:menu-command"
                        | "dsh:resource"
                )
        }
        "tray" => {
            read || matches!(
                ch,
                "quota:refresh"
                    | "quota:set"
                    | "quota:authorize"
                    | "quota:disconnect"
                    | "quota:navigation:get"
                    | "quota:navigation:ack"
                    | "quota:dialog-state"
                    | "tray-popover:resize"
                    | "tray-popover:hide"
                    | "shell:open-external"
                    | "window:show"
            )
        }
        "pet" => matches!(ch, "pet:get" | "pet:command" | "window:show"),
        "dsh-pet" => ch.starts_with("dsh:") && ch != "dsh:resource" || ch == "window:show",
        label if label.starts_with("reference-") => {
            read || matches!(
                ch,
                "window:close"
                    | "window:minimize"
                    | "window:toggle-maximize"
                    | "shell:open-external"
                    | "share-card:copy-image"
                    | "appearance:set"
                    | "locale:set"
                    | "dashboard-range:set"
                    | "notifications:navigation-get"
                    | "dsh-pet:navigation-get"
            )
        }
        _ => false,
    };
    if !allowed {
        return Err("Operation unavailable in this window".into());
    }
    let state = app.state::<HostState>();
    if label == "pet" && ch == "pet:command" && value != "context-menu"
        || label == "dsh-pet"
            && matches!(
                ch,
                "dsh:bounds" | "dsh:busy" | "dsh:regions" | "dsh:interactive"
            )
    {
        return pet_window::input(&app, label, ch, value).await;
    }
    if ch == "dsh:context-menu" || label == "pet" && ch == "pet:command" && value == "context-menu"
    {
        return pet_menu(&app, &window, value).await;
    }
    let native = match ch {
        "settings:navigation-get" if label == "main" => {
            return Ok(state.settings.lock().unwrap().clone().unwrap_or(Value::Null));
        }
        "settings:navigation-ack" if label == "main" => {
            let mut pending = state.settings.lock().unwrap();
            if pending.as_ref().is_some_and(|request| request["requestId"] == *value) {
                pending.take();
            }
            return Ok(Value::Null);
        }
        "renderer-preferences:legacy" if label == "main" => {
            let directory = sidecar::legacy_renderer_storage(&app)?;
            return tauri::async_runtime::spawn_blocking(move || legacy_preferences::read(&directory))
                .await
                .map_err(|e| e.to_string())?
                .map(|values| json!(values));
        }
        #[cfg(not(windows))]
        "dsh:context-menu-close" => {
            state.pet_menu.lock().unwrap().take();
            return Ok(Value::Null);
        }
        "appearance:watch-visibility" => {
            host::desktop_event(
                &app,
                label,
                "appearance:visibility",
                json!([
                    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
                ]),
            );
            Ok(())
        }
        "appearance:unwatch-visibility" => Ok(()),
        "tray-popover:resize" if label == "tray" => {
            popover::resize(&app, value.as_f64().ok_or("Invalid tray height")?)
        }
        "tray-popover:hide" if label == "tray" => {
            if !state.dialog.load(Ordering::SeqCst) {
                window.hide()
            } else {
                Ok(())
            }
        }
        "quota:dialog-state" => {
            state
                .dialog
                .store(value.as_bool() == Some(true), Ordering::SeqCst);
            Ok(())
        }
        "quota:navigation:get" => {
            return Ok(state.quota.lock().unwrap().clone().unwrap_or(Value::Null))
        }
        "quota:navigation:ack" => {
            let mut q = state.quota.lock().unwrap();
            if q.as_ref().is_some_and(|r| r["requestId"] == *value) {
                q.take();
            }
            Ok(())
        }
        "autostart:set" => {
            return tray_menu::save_login(&app, value.as_bool().ok_or("Invalid login preference")?)
                .await
        }
        "share-card:copy-image" => {
            let Some(data) = value
                .as_str()
                .and_then(|s| s.strip_prefix("data:image/png;base64,"))
                .filter(|s| s.len() < 20_000_000)
            else {
                return Ok(json!(false));
            };
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| "Invalid PNG")?;
            let image = tauri::image::Image::from_bytes(&decoded).map_err(|_| "Invalid PNG")?;
            app.clipboard()
                .write_image(&image)
                .map_err(|e| e.to_string())?;
            return Ok(json!(true));
        }
        "quota:shortcut-get" => return Ok(json!(!state.shortcut.lock().await.is_empty())),
        "quota:set"
            if value.get("quotaShortcut").is_some()
                || value.get("quotaShortcutAccelerator").is_some() =>
        {
            return save_shortcut(&app, label, args).await;
        }
        "auto-update:get-state"
        | "auto-update:ack-completed"
        | "auto-update:check"
        | "auto-update:install" => return updates::handle(&app, ch).await,
        "window:minimize" => window.minimize(),
        "window:toggle-maximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "window:close" => window.close(),
        "window:show" => {
            if label == "tray" {
                let _ = window.hide();
            }
            show(&app, "main")
        }
        "app:quit" => {
            quit(&app);
            Ok(())
        }
        "shell:open-external" => {
            let url = args
                .first()
                .and_then(Value::as_str)
                .and_then(|s| tauri::Url::parse(s).ok())
                .filter(|u| {
                    matches!(u.scheme(), "http" | "https")
                        && u.host().is_some()
                        && u.username().is_empty()
                        && u.password().is_none()
                })
                .ok_or("Invalid external URL")?;
            app.opener()
                .open_url(url.as_str(), None::<&str>)
                .map_err(|e| e.to_string())?;
            return Ok(json!({"ok":true}));
        }
        _ => {
            return app
                .state::<Sidecar>()
                .request(&app, window.label(), &channel, args)
                .await
        }
    };
    native.map(|_| Value::Null).map_err(|e| e.to_string())
}

fn apply_autostart(_app: &AppHandle, enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) || std::env::var("QUOTERN_DEV_ISOLATED").as_deref() == Ok("1") {
        return Ok(());
    }
    #[cfg(windows)]
    {
        // A portable's extracted host is deleted on exit. Register its stable launcher.
        use std::io::ErrorKind;
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
            .map_err(|e| e.to_string())?
            .0;
        if !enabled {
            return match key.delete_value("Quotern") {
                Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            };
        }
        let launcher = std::env::var_os("PORTABLE_EXECUTABLE_FILE")
            .map(std::path::PathBuf::from)
            .filter(|p| p.is_absolute() && p.is_file())
            .map_or_else(std::env::current_exe, Ok)
            .map_err(|e| e.to_string())?;
        let command = format!("\"{}\" --autostart", launcher.display());
        if key.get_value::<String, _>("Quotern").ok().as_ref() != Some(&command) {
            key.set_value("Quotern", &command)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let manager = _app.autolaunch();
        let active = manager.is_enabled().map_err(|e| e.to_string())?;
        if active != enabled {
            if enabled {
                manager.enable()
            } else {
                manager.disable()
            }
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
fn normalize_key(key: &str) -> String {
    key.replace(
        "CommandOrControl",
        if cfg!(target_os = "macos") {
            "Super"
        } else {
            "Control"
        },
    )
    .replace("Command", "Super")
}
async fn save_shortcut(app: &AppHandle, label: &str, args: Vec<Value>) -> Result<Value, String> {
    let state = app.state::<HostState>();
    let mut previous = state.shortcut.lock().await;
    let node = app.state::<Sidecar>();
    let current = node.request(app, "host", "quota:get", vec![]).await?;
    let patch = &args[0];
    let prefs = &current["preferences"];
    let enabled = patch["quotaShortcut"]
        .as_bool()
        .unwrap_or(prefs["quotaShortcut"].as_bool() == Some(true));
    let key = normalize_key(
        patch["quotaShortcutAccelerator"]
            .as_str()
            .or(prefs["quotaShortcutAccelerator"].as_str())
            .unwrap_or("CommandOrControl+Shift+U"),
    );
    let added = key != *previous && (enabled || patch.get("quotaShortcutAccelerator").is_some());
    if added {
        app.global_shortcut()
            .register(key.as_str())
            .map_err(|_| "QUOTA_SHORTCUT_UNAVAILABLE")?;
    }
    let result = node.request(app, label, "quota:set", args).await;
    if added && (result.is_err() || !enabled) {
        app.global_shortcut()
            .unregister(key.as_str())
            .map_err(|e| e.to_string())?;
    }
    if result.is_ok() {
        if !previous.is_empty() && (!enabled || key != *previous) {
            app.global_shortcut()
                .unregister(previous.as_str())
                .map_err(|e| e.to_string())?;
        }
        *previous = if enabled { key } else { String::new() };
    }
    result
}
async fn pet_menu(app: &AppHandle, window: &WebviewWindow, tree: &Value) -> Result<Value, String> {
    use tauri::menu::{CheckMenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
    fn item(
        app: &AppHandle,
        model: &Value,
        prefix: &str,
    ) -> tauri::Result<MenuItemKind<tauri::Wry>> {
        if model["type"] == "separator" {
            return Ok(MenuItemKind::Predefined(PredefinedMenuItem::separator(
                app,
            )?));
        }
        let label = model["label"].as_str().unwrap_or("");
        let active = model["enabled"] != false;
        let id = format!("{prefix}{}", model["id"].as_str().unwrap_or(""));
        if let Some(children) = model["submenu"].as_array() {
            let submenu = Submenu::new(app, label, active)?;
            for child in children {
                submenu.append(&item(app, child, prefix)?)?;
            }
            return Ok(MenuItemKind::Submenu(submenu));
        }
        if model["type"] == "radio" {
            return Ok(MenuItemKind::Check(CheckMenuItem::with_id(
                app,
                id,
                label,
                active,
                model["checked"] == true,
                None::<&str>,
            )?));
        }
        Ok(MenuItemKind::MenuItem(MenuItem::with_id(
            app,
            id,
            label,
            active,
            None::<&str>,
        )?))
    }
    fn find<'a>(rows: &'a [Value], id: &str) -> Option<&'a Value> {
        rows.iter().find_map(|r| {
            if r["id"] == id {
                Some(r)
            } else {
                r["submenu"].as_array().and_then(|s| find(s, id))
            }
        })
    }
    let kind = if window.label() == "pet" {
        "builtin"
    } else {
        "dsh"
    };
    let model = app
        .state::<Sidecar>()
        .request(app, "host", "pet:menu", vec![json!(kind), tree.clone()])
        .await?;
    let rows = model["items"].as_array().ok_or("Invalid pet menu")?;
    let state = app.state::<HostState>();
    let prefix = format!("petmenu-{}-", state.seq.fetch_add(1, Ordering::Relaxed));
    let menu = Menu::new(app).map_err(|e| e.to_string())?;
    for row in rows {
        menu.append(&item(app, row, &prefix).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    let selected = pet_window::choose_menu(window, menu, rows.clone()).await?;
    #[cfg(not(windows))]
    let selected = {
        let (send, recv) = tokio::sync::oneshot::channel();
        *state.pet_menu.lock().unwrap() = Some((prefix.clone(), send));
        window.popup_menu(&menu).map_err(|e| e.to_string())?;
        // On Windows and macOS the platform popup returns when it is dismissed.
        // Queue cleanup after any menu selection already dispatched on the UI thread.
        #[cfg(target_os = "macos")]
        {
            let app_handle = app.clone();
            let menu_prefix = prefix.clone();
            app.run_on_main_thread(move || {
                let state = app_handle.state::<HostState>();
                let mut slot = state.pet_menu.lock().unwrap();
                if slot.as_ref().is_some_and(|s| s.0 == menu_prefix) {
                    slot.take();
                }
            })
            .map_err(|e| e.to_string())?;
        }
        let selected = tokio::time::timeout(std::time::Duration::from_secs(90), recv).await;
        {
            let mut slot = state.pet_menu.lock().unwrap();
            if slot.as_ref().is_some_and(|s| s.0 == prefix) {
                slot.take();
            }
        }
        selected.ok().and_then(Result::ok)
    };
    if let Some(id) = selected {
        if let Some(row) = find(rows, &id) {
            if let Some(local) = row.get("local") {
                return Ok(json!({"local":local}));
            }
            if kind == "dsh" {
                return Ok(json!({"command":id}));
            }
            return app
                .state::<Sidecar>()
                .request(
                    app,
                    "host",
                    "pet:menu-command",
                    vec![json!(id), json!(kind)],
                )
                .await;
        }
    }
    Ok(Value::Null)
}
fn main() {
    #[cfg(debug_assertions)]
    if std::env::var("QUOTERN_DEV_QUOTA_PREVIEW").as_deref() == Ok("1") {
        tauri::Builder::default()
            .setup(|app| {
                if std::env::var("QUOTERN_DEV_ISOLATED").as_deref() != Ok("1") {
                    return Err("Quota preview needs an isolated development profile".into());
                }
                let url = app
                    .config()
                    .build
                    .dev_url
                    .clone()
                    .ok_or("Missing mock URL")?;
                if url.scheme() != "http"
                    || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
                {
                    return Err("Quota preview requires a loopback URL".into());
                }
                let origin = url.origin();
                WebviewWindowBuilder::new(app, "quota-preview", WebviewUrl::External(url))
                    .title("Quotern Desktop · Mock 预览")
                    .inner_size(1160., 780.)
                    .data_directory(sidecar::profile(app.handle())?)
                    .on_navigation(move |destination| destination.origin() == origin)
                    .build()?;
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("Could not open quota preview");
        return;
    }
    #[cfg(windows)]
    if std::env::args().nth(1).as_deref() == Some("--quotern-notification-action") {
        use std::os::windows::process::CommandExt;
        let forwarded = sidecar::runtime_files(None).ok().and_then(|(node, dir)| {
            std::process::Command::new(node)
                .arg(dir.join("notification-action.cjs"))
                .args(std::env::args_os().skip(1))
                .creation_flags(0x08000000)
                .env_remove("NODE_OPTIONS")
                .env_remove("NODE_PATH")
                .status()
                .ok()
        });
        std::process::exit(if forwarded.is_some_and(|status| status.success()) {
            0
        } else {
            1
        });
    }
    let mut builder = tauri::Builder::default();
    // Independent development worktrees have their own runtime and WebView profile.
    if std::env::var("QUOTERN_DEV_ISOLATED").as_deref() != Ok("1") {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_from_event(app, "main");
        }));
    }
    // Windows renders local links on an HTTP origin. Let the WebView's
    // new-window handler distinguish internal references from external links.
    let application = builder.plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_updater::Builder::new().build()).manage(updates::Updates::default())
        .plugin(tauri_plugin_clipboard_manager::init()).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().arg("--autostart").build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app,_,event|{if event.state==ShortcutState::Pressed{show_from_event(app,"tray");}}).build())
        .register_asynchronous_uri_scheme_protocol("quotern-media",|ctx,request,responder|{
            let app=ctx.app_handle().clone();let label=ctx.webview_label().to_owned();
            tauri::async_runtime::spawn(async move{responder.respond(resources::respond(app,label,request).await);});
        })
        .manage(Sidecar::default()).manage(Quitting(AtomicBool::new(false))).manage(HostState::default()).manage(pet_window::Pets::default())
        .invoke_handler(tauri::generate_handler![desktop_request])
        .on_menu_event(|app,event|{
            let state=app.state::<HostState>();let mut slot=state.pet_menu.lock().unwrap();
            if let Some(id)=slot.as_ref().and_then(|s|event.id.as_ref().strip_prefix(&s.0)).map(str::to_owned){
                if let Some((_,send))=slot.take(){let _=send.send(id);}
            }
        })
        .setup(|app| {
            let menu = tray_menu::create(app.handle())?;
            let mut tray = TrayIconBuilder::with_id("quotern").menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app,event| tray_menu::activate(app,event.id.as_ref()))
                .on_tray_icon_event(|tray,event| {
                    if let TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,rect,position,..} = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("tray") {
                            if w.is_visible().unwrap_or(false) { let _ = w.hide(); return; }
                        }
                        let _ = popover::anchor(app,rect,position);show_from_event(app,"tray");
                    }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            updates::schedule(app.handle().clone());
            host::notification_actions(app.handle()).map_err(std::io::Error::other)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let node=handle.state::<Sidecar>();
                if let Err(e) = node.start(&handle).await { eprintln!("Quotern startup: {e}"); }
                if let Ok(Value::Bool(enabled))=node.request(&handle,"host","autostart:get",vec![]).await{if let Err(e)=apply_autostart(&handle,enabled){eprintln!("Quotern login: {e}");}}
                if let Ok(s)=node.request(&handle,"host","quota:get",vec![]).await{
                    if s["preferences"]["quotaShortcut"]==true {let key=normalize_key(s["preferences"]["quotaShortcutAccelerator"].as_str().unwrap_or("CommandOrControl+Shift+U"));if handle.global_shortcut().register(key.as_str()).is_ok(){*handle.state::<HostState>().shortcut.lock().await=key;}}
                }
                let silent=std::env::args().any(|a|a=="--hidden" || a=="--autostart")&&node.request(&handle,"host","autostart:get-hidden",vec![]).await.ok()==Some(json!(true));
                if !silent{let _=show(&handle,"main");}
                tray_menu::refresh(&handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "tray" && !window.state::<Quitting>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                    host::desktop_event(window.app_handle(), "tray", "appearance:visibility", json!([false]));
                }
            }
            if matches!(event, WindowEvent::Destroyed) {
                let mut children = Vec::new();
                {
                    let state = window.state::<HostState>();
                    let mut references = state.references.lock().unwrap();
                    references.remove(window.label());
                    references.retain(|child, parent| {
                        let belongs_to_window = parent.as_str() == window.label();
                        if belongs_to_window {
                            children.push(child.clone());
                        }
                        !belongs_to_window
                    });
                }
                for child in children {
                    if let Some(reference) = window.get_webview_window(&child) {
                        let _ = reference.destroy();
                    }
                }
            }
            if window.label() == "tray" && matches!(event,WindowEvent::Focused(false)) && !window.state::<HostState>().dialog.load(Ordering::SeqCst) {
                let _ = window.hide();
            }
            if matches!(event,WindowEvent::Focused(_)|WindowEvent::Resized(_)) {
                let _ = window.emit_to(window.label(), "desktop-event", json!({"channel":"appearance:visibility","args":[window.is_visible().unwrap_or(false)&&!window.is_minimized().unwrap_or(false)]}));
                host::desktop_event(window.app_handle(),window.label(),"window:is-maximized",json!([window.is_maximized().unwrap_or(false)]));
            }
            if matches!(event,WindowEvent::Focused(_)|WindowEvent::ThemeChanged(_)) && window.label()=="main"{
                let handle=window.app_handle().clone();let focus=window.is_focused().unwrap_or(false);let dark=window.theme().ok()==Some(tauri::Theme::Dark);
                tauri::async_runtime::spawn(async move{let node=handle.state::<Sidecar>();let _=node.request(&handle,"host","runtime:theme",vec![json!(dark)]).await;
                    let _=node.request(&handle,"host","runtime:foreground",vec![json!(focus)]).await;});
            }
        })
        .build(tauri::generate_context!()).expect("Could not initialize Quotern");
    application.run(|app, event| {
        if matches!(event, RunEvent::Resumed) {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle
                    .state::<Sidecar>()
                    .request(&handle, "host", "runtime:wake", vec![])
                    .await;
            });
        }
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if !app.state::<Quitting>().0.load(Ordering::SeqCst) {
                api.prevent_exit();
                if code.is_some() {
                    quit(app);
                }
            }
        }
    });
}
