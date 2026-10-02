fn main() {
    // tauri-build reads the Windows icon from tauri.conf.json. Keep that as the
    // single source of truth instead of adding a second tauri-winres path here.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    tauri_build::build()
}
