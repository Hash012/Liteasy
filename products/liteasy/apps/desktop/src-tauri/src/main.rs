#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_artifacts;
mod agent_host;
mod agent_state;
mod artifact_catalog_state;
mod artifact_export;
mod assistant_history;
mod data_location;
mod desktop_identity;
mod external_navigation;
mod device_control;
mod direct_model;
mod local_library;
mod local_mcp;
mod note_files;
mod object_store;
mod paper_cache;
mod paper_services;
mod paper_fulltext;
mod selection_lookup;
mod semantic_index;
mod system_fonts;
mod user_paper_store;
mod webdav;
mod workflow_checkpoints;

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--local-mcp") {
        let result = std::env::args()
            .nth(2)
            .ok_or_else(|| "Missing MCP connection file".to_string())
            .and_then(|path| local_mcp::run_stdio(std::path::Path::new(&path)));
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(exit_code) = agent_host::run_external_mode() {
        std::process::exit(exit_code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_deep_link::init())
        .manage(agent_host::AgentHostState::default())
        .manage(local_mcp::LocalMcpState::default())
        .manage(direct_model::DirectModelState::default())
        .manage(selection_lookup::SelectionLookupState::default())
        .manage(paper_fulltext::FullTextState::default())
        .manage(semantic_index::SemanticIndexState::default())
        .manage(local_library::LocalLibraryWatchState::default())
        .setup(|app| {
            data_location::initialize(app.handle()).map_err(std::io::Error::other)?;
            if let Err(error) = object_store::recover(app.handle()) {
                eprintln!("Local object recovery: {error}");
            }
            if let Err(error) = agent_host::start(app.handle().clone()) {
                eprintln!("Liteasy Agent host is unavailable: {error}");
            }
            local_library::start_local_library_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            external_navigation::open_external_url,
            device_control::device_control_request,
            device_control::device_control_journal,
            system_fonts::list_system_fonts,
            semantic_index::semantic_index_dispatch,
            semantic_index::semantic_index_cancel,
            semantic_index::semantic_index_clear_scope,
            semantic_index::request_semantic_service,
            webdav::set_webdav_open_documents,
            webdav::get_webdav_settings,
            webdav::save_webdav_settings,
            webdav::disconnect_webdav,
            webdav::verify_webdav,
            webdav::sync_webdav,
            webdav::workspace::restore_webdav_preferences,
            webdav::workspace::acknowledge_webdav_preferences,
            note_files::note_files_dispatch,
            data_location::get_data_location,
            data_location::choose_data_location,
            data_location::cancel_data_location_change,
            data_location::reveal_data_location,
            data_location::restart_for_data_location,
            data_location::resource_location,
            direct_model::has_direct_model_key,
            direct_model::save_direct_model_key,
            direct_model::delete_direct_model_key,
            direct_model::request_direct_model,
            direct_model::cancel_direct_model_request,
            agent_host::agent_host_reply,
            local_mcp::local_mcp_info,
            local_mcp::local_mcp_configure,
            local_mcp::local_mcp_reply,
            assistant_history::load_assistant_history,
            assistant_history::save_assistant_history,
            paper_services::request_paper_service,
            paper_services::request_paper_service_task,
            paper_fulltext::request_public_document,
            paper_fulltext::cancel_public_document,
            paper_fulltext::release_downloaded_pdf,
            paper_fulltext::import_downloaded_pdf,
            paper_services::save_paper_service_key,
            paper_services::has_paper_service_key,
            paper_services::delete_paper_service_key,
            selection_lookup::request_selection_lookup,
            selection_lookup::cancel_selection_lookup_request,
            selection_lookup::save_selection_lookup_key,
            selection_lookup::has_selection_lookup_key,
            selection_lookup::delete_selection_lookup_key,
            workflow_checkpoints::load_workflow_checkpoints,
            workflow_checkpoints::save_workflow_checkpoints,
            agent_artifacts::list_local_agent_artifacts,
            agent_artifacts::save_local_agent_artifact,
            agent_artifacts::delete_local_agent_artifact,
            object_store::object_store_get,
            object_store::object_store_list,
            object_store::object_store_commit,
            agent_state::load_agent_state,
            agent_state::save_agent_state,
            artifact_catalog_state::load_artifact_catalog_state,
            artifact_catalog_state::save_artifact_catalog_state,
            artifact_export::export_artifact_document,
            artifact_export::list_artifact_exports,
            artifact_export::open_artifact_export,
            artifact_export::remove_artifact_export,
            artifact_export::reveal_artifact_export,
            desktop_identity::begin_desktop_oauth_login,
            desktop_identity::restore_desktop_oauth_session,
            desktop_identity::revoke_desktop_oauth_session,
            local_library::add_metadata_only_library_entry,
            local_library::backup_local_library,
            local_library::create_local_library_folder,
            local_library::empty_local_library_trash,
            local_library::ensure_local_library_relative_folder,
            local_library::list_legacy_local_library_roots,
            local_library::load_local_library_snapshot,
            local_library::begin_local_library_pdf_import,
            local_library::append_local_library_pdf_import,
            local_library::finish_local_library_pdf_import,
            local_library::cancel_local_library_pdf_import,
            local_library::read_local_library_pdf,
            local_library::local_library_pdf_info,
            local_library::read_local_library_pdf_chunk,
            local_library::move_local_library_resource,
            local_library::purge_local_library_trash_item,
            local_library::restore_local_library_trash_item,
            local_library::select_legacy_local_library_root,
            local_library::set_local_library_root,
            local_library::trash_local_library_resource,
            local_library::trash_local_metadata_entry,
            local_library::open_local_library_in_file_manager,
            paper_cache::cache_external_pdf,
            paper_cache::read_cached_pdf,
            paper_cache::promote_cached_pdf_to_library,
            paper_cache::paper_cache_usage,
            paper_cache::clear_paper_cache,
            user_paper_store::load_user_paper_artifact,
            user_paper_store::save_user_paper_artifact
        ])
        .build(tauri::generate_context!())
        .expect("error while building Liteasy desktop");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Resumed) {
            local_library::resume_local_library_watcher(app_handle);
        }
    });
}
