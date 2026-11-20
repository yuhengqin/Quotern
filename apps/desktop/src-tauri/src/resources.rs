use base64::Engine;
use serde_json::{json, Value};
use tauri::{
    http::{Request, Response},
    AppHandle, Manager,
};

pub async fn respond(app: AppHandle, label: String, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let empty = |status: u16| Response::builder().status(status).body(Vec::new()).unwrap();
    let Some(window) = app.get_webview_window(&label) else {
        return empty(403);
    };
    if !window.url().is_ok_and(|url| super::local_url(&app, &url)) {
        return empty(403);
    }
    if let Some(origin) = req.headers().get("Origin") {
        if !origin
            .to_str()
            .ok()
            .and_then(|s| tauri::Url::parse(s).ok())
            .is_some_and(|url| super::local_url(&app, &url))
        {
            return empty(403);
        }
    }
    let method = req.method().as_str();
    let path = req.uri().path();
    // WebView2 preflights cross-origin JSON control reports and ranged media.
    // The initiating local webview and its Origin have already been checked.
    if method == "OPTIONS" {
        let fish = label == "dsh-pet" && path.starts_with("/dsh-pet-7340/");
        let preview = label == "main" && path.starts_with("/dsh-pet-7340/thumb/main/");
        let atlas = matches!(label.as_str(), "pet" | "main") && path.starts_with("/atlas/");
        if !(fish || preview || atlas) {
            return empty(403);
        }
        return Response::builder()
            .status(204)
            .header("access-control-allow-origin", "*")
            .header(
                "access-control-allow-methods",
                if fish { "GET, HEAD, POST" } else { "GET, HEAD" },
            )
            .header("access-control-allow-headers", "Content-Type, Range")
            .body(Vec::new())
            .unwrap();
    }
    let node = app.state::<super::Sidecar>();
    let result = if let Some(atlas) = path.strip_prefix("/atlas/") {
        let Some((source, id)) = atlas.split_once('/') else {
            return empty(404);
        };
        if !matches!(label.as_str(), "pet" | "main")
            || method != "GET"
            || !matches!(source, "asset" | "codex")
            || id.len() > 64
        {
            return empty(403);
        }
        match node
            .request(&app, "host", "pet:atlas", vec![json!(source), json!(id)])
            .await
            .ok()
            .and_then(|s| {
                base64::engine::general_purpose::STANDARD
                    .decode(s.as_str()?)
                    .ok()
            }) {
            Some(data) => {
                return Response::builder()
                    .header("content-type", "image/webp")
                    .header("access-control-allow-origin", "*")
                    .body(data)
                    .unwrap()
            }
            None => return empty(404),
        }
    } else if path.starts_with("/dsh-pet-7340/") && matches!(method, "GET" | "POST" | "HEAD") {
        if label != "dsh-pet"
            && !(label == "main"
                && matches!(method, "GET" | "HEAD")
                && path.starts_with("/dsh-pet-7340/thumb/main/"))
        {
            return empty(403);
        }
        if req.body().len() > 1024 * 1024 {
            return empty(413);
        }
        let Ok(body) = std::str::from_utf8(req.body()) else {
            return empty(400);
        };
        let url = req
            .uri()
            .path_and_query()
            .map(|v| v.as_str())
            .unwrap_or(path);
        node.request(
            &app,
            "host",
            "dsh:resource",
            vec![
                json!({"id":1,"url":url,"method":if method=="HEAD"{"GET"}else{method},"body":body}),
            ],
        )
        .await
    } else {
        return empty(404);
    };
    let Ok(value) = result else { return empty(503) };
    let status = value["status"].as_u64().unwrap_or(500) as u16;
    let mime = value["contentType"].as_str().unwrap_or("application/json");
    if let Some(file) = value.get("file").and_then(Value::as_str) {
        return super::media::file_response(
            std::path::Path::new(file),
            mime,
            req.headers().get("Range").and_then(|v| v.to_str().ok()),
            method == "HEAD",
        )
        .await;
    }
    Response::builder()
        .status(status)
        .header("content-type", mime)
        .header("access-control-allow-origin", "*")
        .header("cache-control", "no-store")
        .body(value["body"].as_str().unwrap_or("").as_bytes().to_vec())
        .unwrap()
}
