#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_host;
mod agent_state;
mod artifact_catalog_state;
mod import;
mod local_library;
mod skill_documents;

fn main() {
    if let Some(exit_code) = agent_host::run_external_mode() {
        std::process::exit(exit_code);
    }

    tauri::Builder::default()
        .manage(agent_host::AgentHostState::default())
        .setup(|app| {
            if let Err(error) = agent_host::start(app.handle().clone()) {
                eprintln!("Liteasy Agent host is unavailable: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agent_host::agent_host_reply,
            agent_state::load_agent_state,
            agent_state::save_agent_state,
            artifact_catalog_state::load_artifact_catalog_state,
            artifact_catalog_state::save_artifact_catalog_state,
            import::mock_import,
            local_library::load_local_library_snapshot,
            local_library::import_local_library_pdfs,
            local_library::read_local_library_pdf,
            local_library::move_local_library_resource,
            skill_documents::save_skill_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running Liteasy desktop");
}
