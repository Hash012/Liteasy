#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_host;
mod agent_state;
mod artifact_catalog_state;
mod import;
mod local_library;
mod paper_cache;
mod skill_documents;
mod user_paper_store;

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
            local_library::add_metadata_only_library_entry,
            local_library::load_local_library_snapshot,
            local_library::import_local_library_pdfs,
            local_library::read_local_library_pdf,
            local_library::move_local_library_resource,
            local_library::set_local_library_root,
            local_library::open_local_library_in_file_manager,
            paper_cache::cache_external_pdf,
            paper_cache::read_cached_pdf,
            paper_cache::promote_cached_pdf_to_library,
            paper_cache::paper_cache_usage,
            paper_cache::clear_paper_cache,
            user_paper_store::load_user_paper_artifact,
            user_paper_store::save_user_paper_artifact,
            skill_documents::save_skill_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running Liteasy desktop");
}
