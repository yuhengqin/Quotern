use std::{
    io::{self, ErrorKind},
    path::Path,
};
use winreg::RegKey;

// Keep Electron's Windows value name so a login task disabled in Windows
// Startup Apps keeps its approval state across the migration.
const LOGIN_NAME: &str = "dev.quotern.desktop";
const PREVIEW_NAME: &str = "Quotern";

fn delete_if_present(key: &RegKey, name: &str) -> io::Result<()> {
    match key.delete_value(name) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

pub fn apply(key: &RegKey, launcher: &Path, enabled: bool) -> io::Result<()> {
    let command = format!("\"{}\" --autostart", launcher.display());
    if enabled {
        if key.get_value::<String, _>(LOGIN_NAME).ok().as_ref() != Some(&command) {
            key.set_value(LOGIN_NAME, &command)?;
        }
    } else {
        delete_if_present(key, LOGIN_NAME)?;
    }
    if key
        .get_value::<String, _>(PREVIEW_NAME)
        .is_ok_and(|value| value.eq_ignore_ascii_case(&command))
    {
        delete_if_present(key, PREVIEW_NAME)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use winreg::enums::HKEY_CURRENT_USER;

    #[test]
    fn migrating_login_keeps_the_electron_value_name_and_removes_the_duplicate() -> io::Result<()> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let name = format!(
            "Software\\Quotern-startup-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        );
        let (key, _) = root.create_subkey(&name)?;
        let result = (|| -> io::Result<()> {
            let path = Path::new(r"C:\Quotern Sandbox\Quotern.exe");
            let expected = "\"C:\\Quotern Sandbox\\Quotern.exe\" --autostart";
            key.set_value("dev.quotern.desktop", &"\"C:\\Quotern Sandbox\\Quotern.exe\" --hidden")?;
            key.set_value("Quotern", &expected)?;
            apply(&key, path, true)?;
            assert_eq!(key.get_value::<String, _>("dev.quotern.desktop")?, expected);
            assert!(key.get_value::<String, _>("Quotern").is_err());
            apply(&key, path, false)?;
            assert!(key.get_value::<String, _>("dev.quotern.desktop").is_err());
            Ok(())
        })();
        drop(key);
        root.delete_subkey(name)?;
        result
    }
}
