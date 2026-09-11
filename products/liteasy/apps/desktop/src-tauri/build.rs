fn main() {
    // tauri-build reads the Windows icon from tauri.conf.json. Keep that as the
    // single source of truth instead of adding a second tauri-winres path here.
    tauri_build::build()
}
