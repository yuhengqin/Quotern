use rusty_leveldb::{in_memory, DB};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    time::SystemTime,
};

const MAX_SNAPSHOT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FILES: usize = 256;
const PREFERENCES: [&str; 3] = [
    "quotern-token-unit-mode",
    "tud.dashboardRange",
    "tud.dashboardCustomRange",
];

pub fn directory(profile: &Path) -> PathBuf {
    profile.join("Local Storage").join("leveldb")
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct DatabaseFile {
    name: String,
    len: u64,
    modified: SystemTime,
}

fn numbered(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn snapshot_files(source: &Path) -> io::Result<Vec<DatabaseFile>> {
    let mut total = 0;
    let mut files = Vec::new();
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let database_file = name == "CURRENT"
            || name.strip_prefix("MANIFEST-").is_some_and(numbered)
            || name
                .rsplit_once('.')
                .is_some_and(|(stem, ext)| matches!(ext, "log" | "ldb" | "sst") && numbered(stem));
        if !database_file {
            continue;
        }
        let metadata = entry.metadata()?;
        if !metadata.is_file()
            || files.len() >= MAX_FILES
            || metadata.len() > MAX_SNAPSHOT_BYTES - total
        {
            return Err(io::Error::other(
                "Legacy preferences snapshot exceeds its bounds",
            ));
        }
        total += metadata.len();
        files.push(DatabaseFile {
            name,
            len: metadata.len(),
            modified: metadata.modified()?,
        });
    }
    files.sort_unstable();
    Ok(files)
}

/// Recover only the app's old renderer settings from a bounded in-memory
/// snapshot. Chromium keeps ownership of the original database, including its locks.
pub fn read(source: &Path) -> Result<BTreeMap<String, String>, String> {
    match fs::symlink_metadata(source.join("CURRENT")) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Ok(metadata) if metadata.is_file() && metadata.len() <= 256 => {}
        _ => return Err("Legacy preferences database is unavailable".into()),
    }
    let files = snapshot_files(source).map_err(|_| "Could not inspect legacy preferences")?;
    let mut options = in_memory();
    options.create_if_missing = false;
    options.paranoid_checks = true;
    let copy = Path::new("legacy-preferences");
    options.env.mkdir(copy).map_err(|e| e.to_string())?;
    for file in &files {
        let input =
            File::open(source.join(&file.name)).map_err(|_| "Legacy preferences changed")?;
        let mut output = options
            .env
            .open_writable_file(&copy.join(&file.name))
            .map_err(|e| e.to_string())?;
        let copied = io::copy(&mut input.take(file.len + 1), &mut output)
            .map_err(|_| "Could not copy legacy preferences")?;
        if copied != file.len {
            return Err("Legacy preferences changed".into());
        }
    }
    if files != snapshot_files(source).map_err(|_| "Legacy preferences changed")? {
        return Err("Legacy preferences changed".into());
    }
    let mut database =
        DB::open(copy, options).map_err(|_| "Could not recover legacy preferences")?;
    preferences(&mut database).map_err(|_| "Could not read legacy preferences".into())
}

fn preferences(database: &mut DB) -> rusty_leveldb::Result<BTreeMap<String, String>> {
    let snapshot = database.get_snapshot();
    let mut values = BTreeMap::new();
    for preference in PREFERENCES {
        // Chromium's file origin and Latin-1 encoding for ASCII storage keys.
        let key = [b"_file://\0\x01", preference.as_bytes()].concat();
        if let Some(value) = database.get_at(&snapshot, &key)? {
            if let Some(decoded) = decode_value(&value) {
                values.insert(preference.to_owned(), decoded);
            }
        }
    }
    Ok(values)
}

fn decode_value(value: &[u8]) -> Option<String> {
    if value.len() > 1024 {
        return None;
    }
    let (&encoding, bytes) = value.split_first()?;
    match encoding {
        1 => Some(bytes.iter().copied().map(char::from).collect()),
        0 if bytes.len() % 2 == 0 => {
            let units: Vec<_> = bytes
                .chunks_exact(2)
                .map(|unit| u16::from_le_bytes([unit[0], unit[1]]))
                .collect();
            String::from_utf16(&units).ok()
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_allowlisted_file_origin_preferences() {
        let mut database = DB::open("fixture", in_memory()).unwrap();
        database
            .put(
                b"_file://\0\x01quotern-token-unit-mode",
                b"\x01international",
            )
            .unwrap();
        database
            .put(
                b"_file://\0\x01tud.dashboardRange",
                b"\0\"\0t\0o\0d\0a\0y\0\"\0",
            )
            .unwrap();
        database
            .put(
                b"_https://example.test\0\x01tud.dashboardCustomRange",
                b"\x01ignored",
            )
            .unwrap();
        database
            .put(b"_file://\0\x01unrelated", b"\x01ignored")
            .unwrap();
        let restored = preferences(&mut database).unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored["quotern-token-unit-mode"], "international");
        assert_eq!(restored["tud.dashboardRange"], "\"today\"");
    }
}
