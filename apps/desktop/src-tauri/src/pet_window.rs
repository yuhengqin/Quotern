use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Default, Clone)]
struct Input {
    pressed: bool,
    dragging: bool,
    interactive: bool,
    rects: Vec<Value>,
    body: Value,
    band: f64,
    docked: bool,
    revealed: bool,
}
#[derive(Default)]
pub struct Pets {
    builtin: Mutex<Input>,
    fish: Mutex<Input>,
    #[cfg(windows)]
    menu_owner: Mutex<Option<isize>>,
    expected_fish_close: Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>,
}
fn event(app: &AppHandle, label: &str, channel: &str, value: Value) {
    let _ = app.emit_to(
        label,
        "desktop-event",
        json!({"channel":channel,"args":[value]}),
    );
}
fn point_in(rect: &Value, x: f64, y: f64) -> bool {
    let (Some(rx), Some(ry), Some(w), Some(h)) = (
        rect["x"].as_f64(),
        rect["y"].as_f64(),
        rect["width"].as_f64(),
        rect["height"].as_f64(),
    ) else {
        return false;
    };
    x >= rx && x < rx + w && y >= ry && y < ry + h
}

#[derive(Clone, Copy, serde::Serialize)]
struct MonitorRect {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

impl MonitorRect {
    fn new(position: &PhysicalPosition<i32>, size: &PhysicalSize<u32>) -> Self {
        Self {
            x: position.x.into(),
            y: position.y.into(),
            width: size.width.into(),
            height: size.height.into(),
        }
    }
    fn union(self, other: Self) -> Self {
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        Self {
            x,
            y,
            width: (self.x + self.width).max(other.x + other.width) - x,
            height: (self.y + self.height).max(other.y + other.height) - y,
        }
    }
}

fn fish_displays(app: &AppHandle, scale: f64) -> Result<Value, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No primary display")?;
    let primary_index = monitors
        .iter()
        .position(|m| m.position() == primary.position())
        .unwrap_or(0);
    let areas: Vec<_> = monitors
        .iter()
        .map(|m| MonitorRect::new(&m.work_area().position, &m.work_area().size))
        .collect();
    let panels: Vec<_> = monitors
        .iter()
        .map(|m| MonitorRect::new(m.position(), m.size()))
        .collect();
    let hull = areas
        .iter()
        .copied()
        .reduce(MonitorRect::union)
        .ok_or("No display work area")?;
    Ok(
        json!({"hull":hull,"areas":areas,"workAreas":areas,"panels":panels,"primaryIndex":primary_index,"scale":scale}),
    )
}

#[test]
fn display_hull_includes_negative_origins_and_offset_panels() {
    let primary = MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    let rotated = MonitorRect {
        x: -1080,
        y: -200,
        width: 1080,
        height: 1920,
    };
    let hull = primary.union(rotated);
    assert_eq!(
        (hull.x, hull.y, hull.width, hull.height),
        (-1080, -200, 3000, 1920)
    );
}
fn refresh_topmost(
    last: &mut Instant,
    now: Instant,
    visible: bool,
    alive: bool,
    windows: bool,
) -> bool {
    if windows && visible && alive && now.duration_since(*last) >= Duration::from_secs(5) {
        *last = now;
        return true;
    }
    false
}
#[test]
fn visible_windows_refresh_the_native_z_order_until_the_window_is_closed() {
    let start = Instant::now();
    let mut last = start;
    for (ms, visible, alive, windows, refresh) in [
        (4999, true, true, true, false),
        (5000, true, true, true, true),
        (5100, true, true, true, false),
        (10000, false, true, true, false),
        (10001, true, false, true, false),
        (10002, true, true, false, false),
        (10003, true, true, true, true),
    ] {
        assert_eq!(
            refresh_topmost(
                &mut last,
                start + Duration::from_millis(ms),
                visible,
                alive,
                windows
            ),
            refresh
        );
    }
}
fn sample(app: AppHandle, label: &'static str, run: Arc<std::sync::atomic::AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        let mut previous = None;
        let mut ignored = None;
        let mut last_state = None;
        let mut moved = Instant::now();
        let mut idle = false;
        let mut topmost = Instant::now();
        let fish = label == "dsh-pet";
        let mut last_geometry = Value::Null;
        let mut next_display_check = Instant::now();
        while run.load(std::sync::atomic::Ordering::Acquire) {
            tokio::time::sleep(Duration::from_millis(16)).await;
            if !run.load(std::sync::atomic::Ordering::Acquire) {
                break;
            }
            let Some(window) = app.get_webview_window(label) else {
                break;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            if refresh_topmost(
                &mut topmost,
                Instant::now(),
                true,
                run.load(std::sync::atomic::Ordering::Acquire),
                cfg!(windows),
            ) {
                let _ = window.set_always_on_top(true);
            }
            let (Ok(cursor), Ok(position), Ok(size), Ok(scale)) = (
                window.cursor_position(),
                window.outer_position(),
                window.inner_size(),
                window.scale_factor(),
            ) else {
                continue;
            };
            if fish && Instant::now() >= next_display_check {
                next_display_check = Instant::now() + Duration::from_secs(2);
                if let Ok(geometry) = fish_displays(&app, scale) {
                    if geometry != last_geometry {
                        event(&app, label, "pet:displays", geometry.clone());
                        last_geometry = geometry;
                    }
                }
            }
            let data = app.state::<Pets>();
            let input = (if fish { &data.fish } else { &data.builtin })
                .lock()
                .unwrap()
                .clone();
            let x = cursor.x - position.x as f64;
            let y = cursor.y - position.y as f64;
            let side = (size.height as f64 / scale - input.band)
                .min(size.width as f64 / scale)
                .max(40.)
                - 8.;
            let center_x = size.width as f64 / (2. * scale);
            let center_y = (size.height as f64 / scale + input.band) / 2.;
            let over = if fish {
                point_in(&input.body, x, y) || input.rects.iter().any(|r| point_in(r, x, y))
            } else {
                (x / scale - center_x).abs() < side * 0.58
                    && (y / scale - center_y).abs() < side * 0.58
            };
            let mut hover = over;
            if !fish && input.docked && !input.dragging && !input.pressed {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let work = monitor.work_area();
                    let edge = work.position.x as f64 + work.size.width as f64;
                    let width = size.width as f64 / scale;
                    let left = (width - side) / 2.;
                    let target = if input.revealed { width } else { left + 30. };
                    hover = (y / scale - center_y).abs() < side * 0.58
                        && cursor.x >= edge - (target - left + 8.) * scale
                        && cursor.x <= edge;
                    if hover != input.revealed {
                        let shown = if hover { width } else { left + 30. };
                        let _ = window.set_position(PhysicalPosition::new(
                            (edge - shown * scale).round() as i32,
                            position.y,
                        ));
                        data.builtin.lock().unwrap().revealed = hover;
                    }
                }
            }
            let active = over
                || input.dragging
                || input.pressed
                || (fish && input.interactive && input.body.is_null());
            if ignored != Some(!active) {
                let _ = window.set_ignore_cursor_events(!active);
                ignored = Some(!active);
            }
            let look = (((x / scale - center_x)
                .atan2(center_y - y / scale)
                .to_degrees()
                + 360.)
                / 22.5)
                .round() as i32
                % 16;
            if last_state != Some((hover, look)) && !fish {
                let _ = app
                    .state::<super::Sidecar>()
                    .request(&app, "host", "pet:hover", vec![json!(hover), json!(look)])
                    .await;
            }
            let shifted = previous != Some((cursor.x, cursor.y));
            if shifted {
                moved = Instant::now();
            }
            let sleeping = moved.elapsed() > Duration::from_secs(60);
            if idle != sleeping {
                if fish {
                    event(&app, label, "pet:idle", json!(sleeping));
                } else {
                    event(
                        &app,
                        label,
                        "pet:event",
                        json!({"type":if sleeping{"pet:sleep"}else{"pet:wake"},"detail":{"phase":"sleeping"}}),
                    );
                }
                idle = sleeping;
            }
            if (shifted || last_state.map(|v| v.0) != Some(over))
                && !input.pressed
                && !input.dragging
                && (over || last_state.is_some_and(|v| v.0))
            {
                if fish {
                    event(&app, label, "pet:cursor-position", json!({"x":x,"y":y}));
                } else {
                    let point = if over {
                        json!({"x":x/scale,"y":y/scale})
                    } else {
                        Value::Null
                    };
                    event(
                        &app,
                        label,
                        "pet:event",
                        json!({"type":"pet:cursor-position","detail":point}),
                    );
                }
            }
            previous = Some((cursor.x, cursor.y));
            last_state = Some((hover, look));
        }
    });
}
#[cfg(windows)]
async fn watch_fish_webview(window: &tauri::WebviewWindow) -> Result<(), String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler,
        WindowCloseRequestedEventHandler,
    };
    let close = window.clone();
    let failed = window.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |view| {
            let registered = (|| -> windows::core::Result<()> {
                unsafe {
                    let core = view.controller().CoreWebView2()?;
                    let mut token = 0;
                    core.add_WindowCloseRequested(
                        &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                            let _ = close.destroy();
                            Ok(())
                        })),
                        &mut token,
                    )?;
                    core.add_ProcessFailed(
                        &ProcessFailedEventHandler::create(Box::new(move |_, args| {
                            if let Some(args) = args {
                                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                                args.ProcessFailedKind(&mut kind)?;
                                if matches!(
                                    kind,
                                    COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
                                        | COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                                ) {
                                    let _ = failed.destroy();
                                }
                            }
                            Ok(())
                        })),
                        &mut token,
                    )?;
                }
                Ok(())
            })();
            let _ = tx.send(registered.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
pub fn cancel_menu(app: &AppHandle) -> Result<(), String> {
    use windows::Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::WindowsAndMessaging::{PostMessageW, WM_CANCELMODE},
    };
    if let Some(raw) = *app.state::<Pets>().menu_owner.lock().unwrap() {
        unsafe {
            PostMessageW(
                Some(HWND(raw as *mut _)),
                WM_CANCELMODE,
                WPARAM(0),
                LPARAM(0),
            )
        }
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
pub async fn choose_menu(
    window: &tauri::WebviewWindow,
    menu: tauri::menu::Menu<tauri::Wry>,
    rows: Vec<Value>,
) -> Result<Option<String>, String> {
    use tauri::menu::ContextMenu;
    use windows::Win32::{
        Foundation::POINT,
        UI::WindowsAndMessaging::{
            GetCursorPos, GetMenuItemID, GetSubMenu, SetForegroundWindow, TrackPopupMenu, HMENU,
            TPM_NONOTIFY, TPM_RETURNCMD, TPM_RIGHTBUTTON,
        },
    };
    fn selected_id(menu: HMENU, rows: &[Value], selected: u32) -> Option<String> {
        for (index, row) in rows.iter().enumerate() {
            let index = index as i32;
            if let Some(children) = row["submenu"].as_array() {
                let child = unsafe { GetSubMenu(menu, index) };
                if !child.is_invalid() {
                    if let Some(id) = selected_id(child, children, selected) {
                        return Some(id);
                    }
                }
            } else if unsafe { GetMenuItemID(menu, index) } == selected {
                return row["id"].as_str().map(str::to_owned);
            }
        }
        None
    }
    let handle = window.clone();
    let (send, recv) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            // Read the returned command directly. Cancel and select are both definitive
            // before releasing the menu or resolving the renderer's pending request.
            let result = (|| -> Result<Option<String>, String> {
                let hwnd = handle.hwnd().map_err(|e| e.to_string())?;
                let popup = HMENU(menu.hpopupmenu().map_err(|e| e.to_string())? as *mut _);
                let mut point = POINT::default();
                unsafe {
                    GetCursorPos(&mut point).map_err(|e| e.to_string())?;
                    let _ = SetForegroundWindow(hwnd);
                    let pets = handle.state::<Pets>();
                    *pets.menu_owner.lock().unwrap() = Some(hwnd.0 as isize);
                    let selected = TrackPopupMenu(
                        popup,
                        TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
                        point.x,
                        point.y,
                        None,
                        hwnd,
                        None,
                    )
                    .0 as u32;
                    *pets.menu_owner.lock().unwrap() = None;
                    Ok(if selected == 0 {
                        None
                    } else {
                        selected_id(popup, &rows, selected)
                    })
                }
            })();
            let _ = send.send(result);
        })
        .map_err(|e| e.to_string())?;
    recv.await.map_err(|e| e.to_string())?
}

pub async fn set_window(
    app: &AppHandle,
    fish: bool,
    visible: bool,
    settings: &Value,
    generation: u64,
) -> Result<(), String> {
    let label = if fish { "dsh-pet" } else { "pet" };
    let old = app.get_webview_window(label);
    if !visible {
        if let Some(w) = old {
            if fish {
                if let Some(expected) = app
                    .state::<Pets>()
                    .expected_fish_close
                    .lock()
                    .unwrap()
                    .as_ref()
                {
                    expected.store(true, std::sync::atomic::Ordering::Release);
                }
            }
            w.destroy().map_err(|e| e.to_string())?;
            // Wry enqueues destruction. Reopening the same label before the manager
            // releases it would reuse a window that is about to disappear.
            tokio::time::timeout(Duration::from_secs(5), async {
                while app.get_webview_window(label).is_some() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .map_err(|_| format!("Timed out closing {label}"))?;
        }
        return Ok(());
    }
    let work = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No desktop display")?;
    let scale = work.scale_factor();
    let area = work.work_area();
    let width = settings["width"].as_f64().unwrap_or(400.);
    let height = settings["height"].as_f64().unwrap_or(254.);
    if !fish {
        let pets = app.state::<Pets>();
        let mut input = pets.builtin.lock().unwrap();
        input.band = settings["bubbleBand"].as_f64().unwrap_or(138.);
        input.docked = settings["docked"].as_bool().unwrap_or(false);
        input.revealed = false;
    }
    let existing = old.is_some();
    let window = if let Some(w) = old {
        w
    } else {
        let page = if fish {
            let mut params = tauri::Url::parse("http://quotern.invalid/").unwrap();
            let layout = fish_displays(app, scale)?;
            let hull = &layout["hull"];
            params
                .query_pairs_mut()
                .append_pair(
                    "configUrl",
                    "http://quotern-media.localhost/dsh-pet-7340/config",
                )
                .append_pair("openTarget", "desktop")
                .append_pair("scale", &scale.to_string())
                .append_pair("workAreaX", &hull["x"].to_string())
                .append_pair("workAreaY", &hull["y"].to_string())
                .append_pair("workAreaW", &hull["width"].to_string())
                .append_pair("workAreaH", &hull["height"].to_string())
                .append_pair("areas", &layout["areas"].to_string())
                .append_pair("workAreas", &layout["workAreas"].to_string())
                .append_pair("panels", &layout["panels"].to_string())
                .append_pair("primaryIndex", &layout["primaryIndex"].to_string());
            format!("dsh/index.html?{}", params.query().unwrap_or(""))
        } else {
            "pet.html".to_owned()
        };
        let handle = app.clone();
        let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
            .title(if fish {
                "Quotern · 大肥鱼"
            } else {
                "Quotern · Pet"
            })
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .focused(false)
            .focusable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .inner_size(width, height)
            .data_directory(super::sidecar::profile(app)?.join("webview"))
            .initialization_script(super::platform_script())
            .on_navigation(move |url| super::local_url(&handle, url));
        let w = builder.build().map_err(|e| e.to_string())?;
        let running = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let stop = running.clone();
        let expected = Arc::new(std::sync::atomic::AtomicBool::new(false));
        if fish {
            *app.state::<Pets>().expected_fish_close.lock().unwrap() = Some(expected.clone());
        }
        let owner = app.clone();
        w.on_window_event(move |e| {
            if matches!(e, tauri::WindowEvent::Destroyed) {
                stop.store(false, std::sync::atomic::Ordering::Release);
                if fish && !expected.load(std::sync::atomic::Ordering::Acquire) {
                    let owner = owner.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = owner
                            .state::<super::Sidecar>()
                            .request(
                                &owner,
                                "host",
                                "runtime:fish-closed",
                                vec![json!(generation)],
                            )
                            .await;
                    });
                }
            }
        });
        sample(app.clone(), label, running);
        #[cfg(windows)]
        if fish {
            watch_fish_webview(&w).await?;
        }
        w
    };
    if !fish {
        let x = settings["position"]["x"]
            .as_f64()
            .unwrap_or((area.position.x as f64 + area.size.width as f64) / scale - width - 48.);
        let y = settings["position"]["y"]
            .as_f64()
            .unwrap_or((area.position.y as f64 + area.size.height as f64) / scale - height - 24.);
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    if !existing {
        window
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    }
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())
}
pub async fn input(
    app: &AppHandle,
    label: &str,
    channel: &str,
    value: &Value,
) -> Result<Value, String> {
    let window = app.get_webview_window(label).ok_or("Pet window closed")?;
    let data = app.state::<Pets>();
    if label == "dsh-pet" {
        match channel {
            "dsh:bounds" => {
                let bounded = |key: &str| {
                    value[key]
                        .as_f64()
                        .filter(|n| n.is_finite() && n.abs() < 131072.)
                        .ok_or("Invalid pet bounds")
                };
                let (x, y, w, h) = (
                    bounded("x")?,
                    bounded("y")?,
                    bounded("width")?,
                    bounded("height")?,
                );
                if !(1. ..=16384.).contains(&w) || !(1. ..=16384.).contains(&h) {
                    return Err("Invalid pet size".into());
                }
                data.fish.lock().unwrap().body = json!({"x":value["marginL"],"y":value["marginT"],"width":value["size"],"height":value["size"]});
                window
                    .set_size(PhysicalSize::new(w.round() as u32, h.round() as u32))
                    .map_err(|e| e.to_string())?;
                window
                    .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
                    .map_err(|e| e.to_string())?;
            }
            "dsh:interactive" => {
                data.fish.lock().unwrap().interactive = value.as_bool().unwrap_or(false)
            }
            "dsh:busy" => data.fish.lock().unwrap().pressed = value.as_bool().unwrap_or(false),
            "dsh:regions" => {
                let mut fish = data.fish.lock().unwrap();
                fish.dragging = value["dragging"].as_bool() == Some(true);
                fish.rects = value["rects"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .take(64)
                    .cloned()
                    .collect();
            }
            _ => return Err("Unknown input operation".into()),
        }
    } else if let Some(command) = value.as_str() {
        match command {
            "pointer-down" => data.builtin.lock().unwrap().pressed = true,
            "pointer-up" => data.builtin.lock().unwrap().pressed = false,
            "drag-left" | "drag-right" => {
                data.builtin.lock().unwrap().dragging = true;
                window.start_dragging().map_err(|e| e.to_string())?;
            }
            "drag-end" => {
                data.builtin.lock().unwrap().dragging = false;
                let scale = window.scale_factor().map_err(|e| e.to_string())?;
                let monitor = window
                    .current_monitor()
                    .map_err(|e| e.to_string())?
                    .ok_or("No desktop display")?;
                let area = monitor.work_area();
                let p = window
                    .outer_position()
                    .map_err(|e| e.to_string())?
                    .to_logical::<f64>(scale);
                app.state::<super::Sidecar>()
                    .request(
                        app,
                        "host",
                        "pet:placed",
                        vec![json!({"x":p.x,"y":p.y}), json!({"x":area.position.x as f64/scale,"y":area.position.y as f64/scale,"width":area.size.width as f64/scale,"height":area.size.height as f64/scale})],
                    )
                    .await?;
            }
            _ => {
                return app
                    .state::<super::Sidecar>()
                    .request(app, label, channel, vec![value.clone()])
                    .await
            }
        }
    }
    Ok(Value::Null)
}
