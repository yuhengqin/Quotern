use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock,
};
use tauri::AppHandle;

static APP: OnceLock<AppHandle> = OnceLock::new();
static NATIVE_TERMINATION: AtomicBool = AtomicBool::new(false);

extern "C" {
    fn quotern_macos_defer_quit(callback: extern "C" fn()) -> bool;
    fn quotern_macos_reply_quit();
}

extern "C" fn request_quit() {
    if let Some(app) = APP.get() {
        NATIVE_TERMINATION.store(true, Ordering::SeqCst);
        crate::quit(app);
    }
}

pub fn attach(app: &AppHandle) {
    if APP.set(app.clone()).is_ok() && !unsafe { quotern_macos_defer_quit(request_quit) } {
        eprintln!("Could not defer native macOS Quit through the application delegate");
    }
}

pub fn reply() -> bool {
    if !NATIVE_TERMINATION.swap(false, Ordering::SeqCst) {
        return false;
    }
    unsafe { quotern_macos_reply_quit() };
    true
}
