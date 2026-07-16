#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod import;
mod local_library;
mod skill_documents;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            import::mock_import,
            local_library::load_local_library_snapshot,
            skill_documents::save_skill_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running Liteasy desktop");
}
