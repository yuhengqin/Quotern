use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{Response, StatusCode};

// JavaScript's fileResponse rejects range endpoints outside its safe integer range.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, PartialEq, Eq)]
enum Selection {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

// Saturating parsing lets a large end or suffix be clipped to the file size,
// while still rejecting an out-of-range start.
fn decimal(value: &str) -> Option<u64> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(value.bytes().fold(0u64, |number, byte| {
        number
            .saturating_mul(10)
            .saturating_add(u64::from(byte - b'0'))
    }))
}

fn select_range(size: u64, range: Option<&str>) -> Selection {
    let range = match range {
        None | Some("") => return Selection::Full,
        Some(range) => range,
    };
    let Some(value) = range.strip_prefix("bytes=") else {
        return Selection::Unsatisfiable;
    };
    let Some((first, last)) = value.split_once('-') else {
        return Selection::Unsatisfiable;
    };
    if size == 0 || (first.is_empty() && last.is_empty()) {
        return Selection::Unsatisfiable;
    }
    let end_of_file = size - 1;
    let (start, end) = if first.is_empty() {
        let Some(suffix) = decimal(last) else {
            return Selection::Unsatisfiable;
        };
        (size.saturating_sub(suffix), end_of_file)
    } else {
        let Some(start) = decimal(first) else {
            return Selection::Unsatisfiable;
        };
        let end = if last.is_empty() {
            end_of_file
        } else {
            let Some(end) = decimal(last) else {
                return Selection::Unsatisfiable;
            };
            end.min(end_of_file)
        };
        (start, end)
    };
    if start > end || start > MAX_SAFE_INTEGER || end > MAX_SAFE_INTEGER {
        Selection::Unsatisfiable
    } else {
        Selection::Partial { start, end }
    }
}

fn empty_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).unwrap()
}

fn read_response(path: &Path, mime: &str, range: Option<&str>, head: bool) -> Response<Vec<u8>> {
    let Ok(mut file) = File::open(path) else {
        return empty_response(StatusCode::NOT_FOUND);
    };
    let Ok(metadata) = file.metadata() else {
        return empty_response(StatusCode::NOT_FOUND);
    };
    if !metadata.is_file() {
        return empty_response(StatusCode::NOT_FOUND);
    }
    let size = metadata.len();
    let selection = select_range(size, range);
    let mut response = Response::builder()
        .header("access-control-allow-origin", "*")
        .header(
            "access-control-expose-headers",
            "Accept-Ranges, Content-Range",
        )
        .header("accept-ranges", "bytes")
        .header("content-type", mime);
    let (start, length) = match selection {
        Selection::Full => {
            response = response.status(StatusCode::OK);
            (0, size)
        }
        Selection::Partial { start, end } => {
            response = response
                .status(StatusCode::PARTIAL_CONTENT)
                .header("content-range", format!("bytes {start}-{end}/{size}"));
            (start, end - start + 1)
        }
        Selection::Unsatisfiable => {
            return response
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("content-range", format!("bytes */{size}"))
                .header("content-length", "0")
                .body(Vec::new())
                .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR));
        }
    };
    let mut body = Vec::new();
    if !head && length != 0 {
        if file.seek(SeekFrom::Start(start)).is_err()
            || file.take(length).read_to_end(&mut body).is_err()
            || body.len() as u64 != length
        {
            return empty_response(StatusCode::NOT_FOUND);
        }
    }
    response
        .header("content-length", length.to_string())
        .body(body)
        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Serve a file whose path has already passed the caller's read-only allowlist.
pub async fn file_response(
    path: &Path,
    mime: &str,
    range: Option<&str>,
    head: bool,
) -> Response<Vec<u8>> {
    let path = path.to_owned();
    let mime = mime.to_owned();
    let range = range.map(str::to_owned);
    tokio::task::spawn_blocking(move || read_response(&path, &mime, range.as_deref(), head))
        .await
        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(test)]
mod tests {
    use super::{select_range, Selection};

    #[test]
    fn selects_full_and_single_ranges() {
        assert_eq!(select_range(10, None), Selection::Full);
        assert_eq!(select_range(0, Some("")), Selection::Full);
        assert_eq!(
            select_range(10, Some("bytes=0-0")),
            Selection::Partial { start: 0, end: 0 }
        );
        assert_eq!(
            select_range(10, Some("bytes=2-4")),
            Selection::Partial { start: 2, end: 4 }
        );
        assert_eq!(
            select_range(10, Some("bytes=8-")),
            Selection::Partial { start: 8, end: 9 }
        );
        assert_eq!(
            select_range(10, Some("bytes=-3")),
            Selection::Partial { start: 7, end: 9 }
        );
        assert_eq!(
            select_range(10, Some("bytes=-999999999999999999999")),
            Selection::Partial { start: 0, end: 9 }
        );
        assert_eq!(
            select_range(10, Some("bytes=2-999999999999999999999")),
            Selection::Partial { start: 2, end: 9 }
        );
    }

    #[test]
    fn rejects_empty_invalid_and_out_of_bounds_ranges() {
        for (size, range) in [
            (0, "bytes=0-"),
            (10, "bytes=-"),
            (10, "bytes=-0"),
            (10, "bytes=90-"),
            (10, "bytes=4-3"),
            (10, "bytes=1-2,4-5"),
            (10, "bytes=1--2"),
            (10, "items=1-2"),
            (10, "bytes=+1-2"),
            (10, "bytes=999999999999999999999-"),
            (9_007_199_254_740_993, "bytes=9007199254740992-"),
        ] {
            assert_eq!(
                select_range(size, Some(range)),
                Selection::Unsatisfiable,
                "{range}"
            );
        }
    }
}
