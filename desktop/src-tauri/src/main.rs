#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod import;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![import::mock_import])
        .run(tauri::generate_context!())
        .expect("error while running Liteasy desktop");
}
