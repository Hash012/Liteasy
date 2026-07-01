#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod import;
mod local_library;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            import::mock_import,
            local_library::load_local_library_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running Liteasy desktop");
}
