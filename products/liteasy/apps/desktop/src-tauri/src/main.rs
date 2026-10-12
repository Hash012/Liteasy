#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_artifacts;
mod agent_host;
mod agent_state;
mod artifact_catalog_state;
mod artifact_export;
mod assistant_history;
mod chatgpt_plan;
mod chatgpt_stream;
mod codex_backend;
mod data_location;
mod desktop_identity;
mod device_control;
mod direct_model;
mod document_export_cli;
mod document_pdf;
mod external_navigation;
mod headless_cli;
mod local_archive;
mod local_library;
mod local_mcp;
mod local_recovery;
mod native_open;
mod note_files;
mod object_store;
mod paper_cache;
mod paper_fulltext;
mod paper_services;
mod research_demo_cli;
mod research_harness;
mod research_host;
mod research_runner;
mod selection_lookup;
mod semantic_index;
mod system_fonts;
mod user_paper_store;
mod webdav;
mod workflow_checkpoints;

use tauri::Manager;
mod local_dev;

fn main() {
    if let Some(code) = research_host::cli_replay(&std::env::args().skip(1).collect::<Vec<_>>()) {
        std::process::exit(code);
    }
    if let Err(error) = local_dev::initialize() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    let research_demo =
        match research_demo_cli::parse(&std::env::args().skip(1).collect::<Vec<_>>()) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(2);
            }
        };
    let research_demo_setup = research_demo.clone();
    if let Some(code) = headless_cli::run_external_mode(
        data_location::headless_root,
        desktop_identity::local_object_scope,
    ) {
        std::process::exit(code);
    }
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
    let export_cli =
        match document_export_cli::parse_args(&std::env::args().skip(1).collect::<Vec<_>>()) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(2);
            }
        };
    let export_cli_setup = export_cli.clone();
    if export_cli.is_none() && research_demo.is_none() {
        if let Some(exit_code) = agent_host::run_external_mode() {
            std::process::exit(exit_code);
        }
    }
    let mut context = tauri::generate_context!();
    if local_dev::recovery_scope().is_some() || export_cli.is_some() || research_demo.is_some() {
        for window in &mut context.config_mut().app.windows {
            window.create = false;
        }
        let csp = "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; font-src 'self' data:; frame-src 'self' blob: data:; img-src 'self' asset: http://asset.localhost blob: data:; media-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";
        context.config_mut().app.security.csp = Some(tauri::utils::config::Csp::Policy(csp.into()));
        context.config_mut().app.security.dev_csp =
            Some(tauri::utils::config::Csp::Policy(csp.into()));
    }
    let mut builder = tauri::Builder::default();
    if local_dev::recovery_scope().is_none() && export_cli.is_none() && research_demo.is_none() {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
                native_open::enqueue_argv(
                    app,
                    argv.into_iter().map(std::ffi::OsString::from),
                    std::path::Path::new(&cwd),
                );
                native_open::focus_main_window(app);
            }))
            .plugin(tauri_plugin_deep_link::init());
    }
    let app = builder
        .manage(agent_host::AgentHostState::default())
        .manage(local_mcp::LocalMcpState::default())
        .manage(research_host::ResearchHostState::default())
        .manage(chatgpt_plan::ChatgptPlanState::default())
        .manage(codex_backend::CodexBackendState::default())
        .manage(direct_model::DirectModelState::default())
        .manage(selection_lookup::SelectionLookupState::default())
        .manage(paper_fulltext::FullTextState::default())
        .manage(semantic_index::SemanticIndexState::default())
        .manage(local_library::LocalLibraryWatchState::default())
        .setup(move |app| {
            data_location::initialize(app.handle()).map_err(std::io::Error::other)?;
            if let Some(output) = research_demo_setup {
                app.manage(research_demo_cli::ResearchDemoState::new(output));
                tauri::WebviewWindowBuilder::new(
                    app,
                    "research-demo",
                    tauri::WebviewUrl::App("research-demo.html".into()),
                )
                .visible(false)
                .incognito(true)
                .data_directory(
                    data_location::root(app.handle())
                        .map_err(std::io::Error::other)?
                        .join("research-demo-webview"),
                )
                .build()?;
                return Ok(());
            }
            if let Some(request) = export_cli_setup {
                app.manage(document_export_cli::ExportCliState::new(request));
                tauri::WebviewWindowBuilder::new(
                    app,
                    "document-export-cli",
                    tauri::WebviewUrl::App("document-export-cli.html".into()),
                )
                .visible(false)
                .incognito(true)
                .data_directory(
                    data_location::root(app.handle())
                        .map_err(std::io::Error::other)?
                        .join("document-export-cli-webview"),
                )
                .build()?;
                return Ok(());
            }
            if local_dev::recovery_scope().is_some() {
                let root = local_dev::profile_root()
                    .ok_or_else(|| std::io::Error::other("Missing recovery root"))?;
                let config = app
                    .config()
                    .app
                    .windows
                    .first()
                    .ok_or_else(|| std::io::Error::other("Missing window configuration"))?;
                let window = tauri::WebviewWindowBuilder::from_config(app, config)?
                    .title("Liteasy · 隔离恢复资料")
                    .data_directory(
                        local_dev::recovery_webview_directory(root)
                            .map_err(std::io::Error::other)?,
                    );
                // WKWebView does not support data_directory. Its ephemeral store prevents
                // reading normal-profile cookies/settings; native restored files still persist.
                #[cfg(target_os = "macos")]
                let window = window.incognito(true);
                window.build()?;
            }
            // Explicitly set the running window/taskbar icon as well as the EXE
            // resource. Use the full-resolution mark instead of the ICO first frame.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.set_icon(tauri::include_image!("icons/128x128.png")) {
                    eprintln!("Could not set the Liteasy window icon: {error}");
                }
            }

            if local_dev::recovery_scope().is_none() {
                if let Ok(cwd) = std::env::current_dir() {
                    native_open::enqueue_argv(app.handle(), std::env::args_os(), &cwd);
                }
            }
            if let Err(error) = object_store::recover(app.handle()) {
                eprintln!("Local object recovery: {error}");
            }
            if local_dev::profile_root().is_none() {
                if let Err(error) = agent_host::start(app.handle().clone()) {
                    eprintln!("Liteasy Agent host is unavailable: {error}");
                }
            }
            local_library::start_local_library_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler({
            let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
                local_dev::local_runtime_profile,
                research_host::research_host_command,
                research_demo_cli::research_demo_authorize,
                research_demo_cli::research_demo_complete,
                research_harness::research_harness_configure,
                research_harness::research_harness_check,
                chatgpt_plan::chatgpt_plan_accounts,
                chatgpt_plan::chatgpt_plan_login,
                chatgpt_plan::chatgpt_plan_cancel,
                chatgpt_plan::chatgpt_plan_select,
                chatgpt_plan::chatgpt_plan_logout,
                chatgpt_plan::chatgpt_plan_models,
                chatgpt_plan::chatgpt_plan_infer,
                codex_backend::codex_backend_configure,
                codex_backend::codex_backend_capability,
                codex_backend::codex_backend_start,
                codex_backend::codex_backend_send,
                codex_backend::codex_backend_stop,
                local_recovery::local_recovery_prepare_backup,
                local_recovery::local_recovery_prepare_restore,
                local_recovery::local_recovery_commit,
                local_recovery::local_recovery_cancel,
                local_recovery::local_recovery_open_profile,
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
                webdav::ensure_webdav_file,
                webdav::workspace::restore_webdav_preferences,
                webdav::workspace::acknowledge_webdav_preferences,
                note_files::note_files_dispatch,
                local_archive::local_archive_catalog,
                local_archive::local_archive_prepare_export,
                local_archive::local_archive_prepare_restore,
                local_archive::local_archive_commit,
                local_archive::local_archive_cancel,
                local_archive::local_archive_open_restored,
                local_archive::local_archive_reveal,
                local_archive::local_archive_read_note,
                native_open::choose_native_open_file,
                native_open::read_native_open_file,
                native_open::release_native_open_file,
                native_open::drain_native_open_requests,
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
                object_store::object_store_snapshot,
                object_store::object_store_commit,
                agent_state::load_agent_state,
                agent_state::save_agent_state,
                artifact_catalog_state::load_artifact_catalog_state,
                artifact_catalog_state::save_artifact_catalog_state,
                artifact_export::export_artifact_document,
                document_pdf::document_pdf_capability,
                document_export_cli::document_export_cli_source,
                document_export_cli::document_export_cli_image,
                document_export_cli::document_export_cli_complete,
                document_pdf::render_document_pdf,
                document_pdf::cancel_document_pdf,
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
            ];
            move |invoke: tauri::ipc::Invoke| {
                if local_dev::blocked_command(invoke.message.command()) {
                    invoke
                        .resolver
                        .reject(if local_dev::recovery_scope().is_some() {
                            "隔离恢复资料保持离线，请在原工作区使用联网功能。"
                        } else {
                            "local_development_network_and_credentials_disabled"
                        });
                    true
                } else {
                    handler(invoke)
                }
            }
        })
        .build(context)
        .expect("error while building Liteasy desktop");
    let export_cli_mode = export_cli.is_some();
    app.run(move |app_handle, event| {
        if export_cli_mode {
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            native_open::enqueue_urls(app_handle, urls.clone());
        }
        if matches!(event, tauri::RunEvent::Resumed) {
            local_library::resume_local_library_watcher(app_handle);
        }
    });
}
