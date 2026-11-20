use serde_json::Value;
use std::ffi::{c_char, CStr, CString};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();
extern "C" {
    fn quotern_mac_notification_actions(callback: extern "C" fn(*const c_char, *const c_char));
    fn quotern_mac_notification_show(notice: *const c_char) -> i32;
    fn quotern_mac_notification_remove(key: *const c_char);
}

extern "C" fn activated(key: *const c_char, action: *const c_char) {
    if key.is_null() || action.is_null() {
        return;
    }
    let Some(app) = APP.get().cloned() else {
        return;
    };
    let (id, verb) = unsafe { (CStr::from_ptr(key), CStr::from_ptr(action)) };
    let (Ok(id), Ok(verb)) = (id.to_str(), verb.to_str()) else {
        return;
    };
    let args = vec![Value::from(id), Value::from(verb)];
    tauri::async_runtime::spawn(async move {
        let _ = app
            .state::<super::Sidecar>()
            .request(&app, "host", "notifications:activate", args)
            .await;
    });
}
pub fn register(app: &AppHandle) {
    if APP.set(app.clone()).is_ok() {
        unsafe {
            quotern_mac_notification_actions(activated);
        }
    }
}
pub async fn show(notice: &Value) -> Result<(), String> {
    let data = CString::new(notice.to_string()).map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || unsafe {
        quotern_mac_notification_show(data.as_ptr())
    })
    .await
    .map_err(|e| e.to_string())?;
    if result == 1 {
        Ok(())
    } else {
        Err("macOS did not accept the notification".into())
    }
}
pub fn remove(key: &str) -> Result<(), String> {
    let id = CString::new(key).map_err(|e| e.to_string())?;
    unsafe {
        quotern_mac_notification_remove(id.as_ptr());
    }
    Ok(())
}
