#[cfg(windows)]
mod windows_session {
    use std::mem::size_of;
    use windows::{
        core::{BOOL, PWSTR},
        Win32::{
            System::RemoteDesktop::{
                WTSActive, WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx,
                WTSINFOEXW, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_UNLOCK,
            },
            UI::WindowsAndMessaging::{
                SystemParametersInfoW, SPI_GETSCREENSAVERRUNNING,
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
            },
        },
    };

    fn active_and_unlocked(info: WTSINFOEXW) -> bool {
        if info.Level != 1 {
            return false;
        }
        // The Level tag selects the corresponding member of the WTS union.
        let session = unsafe { info.Data.WTSInfoExLevel1 };
        session.SessionState == WTSActive && session.SessionFlags == WTS_SESSIONSTATE_UNLOCK as i32
    }

    pub fn is_unlocked() -> bool {
        let mut buffer = PWSTR::null();
        let mut bytes = 0;
        // Query only this process's session, including when it runs over Remote Desktop.
        unsafe {
            let result = WTSQuerySessionInformationW(
                None,
                WTS_CURRENT_SESSION,
                WTSSessionInfoEx,
                &mut buffer,
                &mut bytes,
            );
            if buffer.is_null() {
                return false;
            }
            let unlocked = result.is_ok()
                && bytes as usize >= size_of::<WTSINFOEXW>()
                && active_and_unlocked(buffer.0.cast::<WTSINFOEXW>().read_unaligned());
            WTSFreeMemory(buffer.0.cast());
            if !unlocked {
                return false;
            }
            let mut screensaver = BOOL(0);
            SystemParametersInfoW(
                SPI_GETSCREENSAVERRUNNING,
                0,
                Some((&mut screensaver as *mut BOOL).cast()),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
            .is_ok()
                && !screensaver.as_bool()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows::Win32::System::RemoteDesktop::{
            WTSDisconnected, WTSINFOEX_LEVEL1_W, WTSINFOEX_LEVEL_W, WTS_SESSIONSTATE_LOCK,
            WTS_SESSIONSTATE_UNKNOWN,
        };

        #[test]
        fn only_an_active_unlocked_session_allows_automation() {
            let mut details = WTSINFOEX_LEVEL1_W {
                SessionState: WTSActive,
                SessionFlags: WTS_SESSIONSTATE_UNLOCK as i32,
                ..Default::default()
            };
            let info = |level, session| WTSINFOEXW {
                Level: level,
                Data: WTSINFOEX_LEVEL_W { WTSInfoExLevel1: session },
            };
            assert!(active_and_unlocked(info(1, details)));
            assert!(!active_and_unlocked(info(0, details)));
            details.SessionState = WTSDisconnected;
            assert!(!active_and_unlocked(info(1, details)));
            details.SessionState = WTSActive;
            for flag in [WTS_SESSIONSTATE_LOCK, WTS_SESSIONSTATE_UNKNOWN] {
                details.SessionFlags = flag as i32;
                assert!(!active_and_unlocked(info(1, details)));
            }
        }
    }
}

#[cfg(windows)]
pub use windows_session::is_unlocked;

#[cfg(target_os = "macos")]
pub fn is_unlocked() -> bool {
    extern "C" {
        fn quotern_macos_session_unlocked() -> bool;
    }
    unsafe { quotern_macos_session_unlocked() }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn is_unlocked() -> bool {
    false
}
