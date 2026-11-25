fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/macos_notifications.m");
        println!("cargo:rerun-if-changed=src/macos_quit.m");
        println!("cargo:rerun-if-changed=src/macos_session.m");
        cc::Build::new()
            .file("src/macos_notifications.m")
            .file("src/macos_quit.m")
            .file("src/macos_session.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("quotern_notifications");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
    }
    let manifest = tauri_build::AppManifest::new().commands(&["desktop_request"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("Tauri desktop manifest");
}
