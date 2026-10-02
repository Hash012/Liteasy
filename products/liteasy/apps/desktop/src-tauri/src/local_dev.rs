//! Isolated local profiles. Release builds ignore development environment variables;
//! recovery requires an explicit validated CLI profile and never restores credentials.
use std::path::PathBuf;
use std::sync::OnceLock;
static PROFILE: OnceLock<Option<PathBuf>> = OnceLock::new();
static RECOVERY_SCOPE: OnceLock<String> = OnceLock::new();
static PROFILE_LOCK: OnceLock<std::fs::File> = OnceLock::new();

/// Restored browser state must not alias the regular profile through a preexisting link.
pub fn recovery_webview_directory(root: &std::path::Path) -> Result<PathBuf, String> {
    let directory = root.join("webview");
    match std::fs::create_dir(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    let metadata = std::fs::symlink_metadata(&directory).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Recovery browser directory cannot be a reparse point".into());
        }
    }
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || directory
            .canonicalize()
            .map_err(|error| error.to_string())?
            != directory
    {
        return Err("Recovery browser directory must remain inside its own profile".into());
    }
    Ok(directory)
}

fn recovery_argument(args: &[std::ffi::OsString]) -> Result<Option<PathBuf>, String> {
    if !args.iter().any(|arg| {
        arg == "--recovery-profile" || arg.to_string_lossy().starts_with("--recovery-profile=")
    }) {
        return Ok(None);
    }
    if args.len() != 2 || args[0] != "--recovery-profile" {
        return Err("Use --recovery-profile followed by one completed recovery folder".into());
    }
    Ok(Some(PathBuf::from(&args[1])))
}
fn lock_profile(root: &std::path::Path) -> Result<std::fs::File, String> {
    let path = root.join(".active.lock");
    if std::fs::symlink_metadata(&path)
        .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
    {
        return Err("Invalid profile lock file".into());
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.try_lock().map_err(|_| {
        "This recovery profile is already open; close its window before reopening".to_string()
    })?;
    Ok(file)
}

pub fn recovery_scope() -> Option<&'static str> {
    RECOVERY_SCOPE.get().map(String::as_str)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfile {
    scope_id: String,
    local_only: bool,
    recovery: bool,
}
#[tauri::command]
pub fn local_runtime_profile() -> Option<RuntimeProfile> {
    recovery_scope().map(|scope| RuntimeProfile {
        scope_id: scope.into(),
        local_only: true,
        recovery: true,
    })
}

pub fn initialize() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Some(path) = recovery_argument(&args)? {
        let profile = crate::local_recovery::validate_profile(&path)?;
        let lock = lock_profile(&profile.profile_root)?;
        PROFILE_LOCK
            .set(lock)
            .map_err(|_| "Profile lock already initialized")?;
        RECOVERY_SCOPE
            .set(profile.archived_scope)
            .map_err(|_| "Recovery already initialized")?;
        return PROFILE
            .set(Some(profile.profile_root))
            .map_err(|_| "Profile already initialized".into());
    }
    #[cfg(debug_assertions)]
    let root = std::env::var_os("LITEASY_LOCAL_DEV_PROFILE")
        .map(|path| validate_profile(PathBuf::from(path)))
        .transpose()?;
    #[cfg(not(debug_assertions))]
    let root = None;
    PROFILE
        .set(root)
        .map_err(|_| "Development profile already initialized".to_string())
}

#[cfg(any(debug_assertions, test))]
fn validate_profile(path: PathBuf) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || std::fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Use an absolute, non-symlink development profile path".into());
    }
    let bytes = std::fs::read(path.join("profile.json")).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if value["schema"] != "liteasy.local-development/v1"
        || !value["id"]
            .as_str()
            .is_some_and(|id| id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err("Invalid development profile marker; original data was not opened".into());
    }
    path.canonicalize().map_err(|e| e.to_string())
}

pub fn profile_root() -> Option<&'static std::path::Path> {
    PROFILE.get().and_then(|root| root.as_deref())
}

pub fn blocked_command(command: &str) -> bool {
    if recovery_scope().is_some() {
        return !recovery_command(command);
    }
    profile_root().is_some() && network_or_credential_command(command)
}
fn network_or_credential_command(command: &str) -> bool {
    // Nothing in this profile may recover a real system credential or start a
    // model/network job. Local file readers and their real IPC remain available.
    command.contains("oauth")
        || command.contains("_key")
        || command.contains("webdav")
        || command.starts_with("request_")
        || command.starts_with("device_control_")
        || matches!(
            command,
            "open_external_url" | "cache_external_pdf" | "local_mcp_configure"
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolation_blocks_credentials_and_network_but_preserves_real_file_ipc() {
        for command in [
            "restore_desktop_oauth_session",
            "has_direct_model_key",
            "request_public_document",
            "sync_webdav",
            "device_control_request",
        ] {
            assert!(network_or_credential_command(command));
        }
        for command in [
            "get_data_location",
            "read_local_library_pdf_chunk",
            "note_files_dispatch",
            "load_agent_state",
            "save_agent_state",
            "choose_native_open_file",
            "read_native_open_file",
            "release_native_open_file",
            "drain_native_open_requests",
        ] {
            assert!(!network_or_credential_command(command));
        }
    }
    #[test]
    fn rejects_unmarked_profile() {
        assert!(validate_profile(std::env::temp_dir()).is_err());
    }
}

// Fail closed for future commands. This is an isolated local workspace, not a login session.
fn recovery_command(command: &str) -> bool {
    matches!(
        command,
        "local_runtime_profile"
            | "list_system_fonts"
            | "get_data_location"
            | "reveal_data_location"
            | "resource_location"
            | "semantic_index_dispatch"
            | "semantic_index_cancel"
            | "semantic_index_clear_scope"
            | "note_files_dispatch"
            | "choose_native_open_file"
            | "read_native_open_file"
            | "release_native_open_file"
            | "drain_native_open_requests"
            | "object_store_get"
            | "object_store_list"
            | "object_store_commit"
            | "load_agent_state"
            | "save_agent_state"
            | "load_assistant_history"
            | "save_assistant_history"
            | "load_artifact_catalog_state"
            | "save_artifact_catalog_state"
            | "load_workflow_checkpoints"
            | "save_workflow_checkpoints"
            | "list_local_agent_artifacts"
            | "save_local_agent_artifact"
            | "delete_local_agent_artifact"
            | "export_artifact_document"
            | "list_artifact_exports"
            | "open_artifact_export"
            | "remove_artifact_export"
            | "reveal_artifact_export"
            | "load_local_library_snapshot"
            | "add_metadata_only_library_entry"
            | "backup_local_library"
            | "create_local_library_folder"
            | "ensure_local_library_relative_folder"
            | "begin_local_library_pdf_import"
            | "append_local_library_pdf_import"
            | "finish_local_library_pdf_import"
            | "cancel_local_library_pdf_import"
            | "read_local_library_pdf"
            | "local_library_pdf_info"
            | "read_local_library_pdf_chunk"
            | "move_local_library_resource"
            | "trash_local_library_resource"
            | "trash_local_metadata_entry"
            | "restore_local_library_trash_item"
            | "empty_local_library_trash"
            | "purge_local_library_trash_item"
            | "open_local_library_in_file_manager"
            | "load_user_paper_artifact"
            | "save_user_paper_artifact"
            | "local_archive_catalog"
            | "local_archive_prepare_export"
            | "local_archive_prepare_restore"
            | "local_archive_commit"
            | "local_archive_cancel"
            | "local_archive_open_restored"
            | "local_archive_reveal"
            | "local_archive_read_note"
            | "local_recovery_prepare_backup"
            | "local_recovery_prepare_restore"
            | "local_recovery_commit"
            | "local_recovery_cancel"
            | "local_recovery_open_profile"
    )
}
#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn explicit_profile_argument_never_falls_through_to_regular_workspace() {
        let args = |values: &[&str]| {
            values
                .iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            recovery_argument(&args(&["--recovery-profile", "/fixture"])).unwrap(),
            Some(PathBuf::from("/fixture"))
        );
        assert!(recovery_argument(&args(&["--recovery-profile"])).is_err());
        assert!(
            recovery_argument(&args(&["--agent-cli", "--recovery-profile", "/fixture"])).is_err()
        );
        assert!(recovery_argument(&args(&["--recovery-profile=/fixture"])).is_err());
        assert!(recovery_argument(&args(&[
            "--recovery-profile",
            "/a",
            "--recovery-profile",
            "/b"
        ]))
        .is_err());
        assert!(recovery_argument(&args(&["original.pdf"]))
            .unwrap()
            .is_none());
    }
    #[test]
    fn restored_scope_is_local_only_and_new_commands_are_unavailable() {
        for command in [
            "restore_desktop_oauth_session",
            "request_direct_model",
            "save_direct_model_key",
            "sync_webdav",
            "open_external_url",
            "local_mcp_configure",
            "choose_data_location",
            "future_network_command",
        ] {
            assert!(!recovery_command(command));
        }
        for command in [
            "local_runtime_profile",
            "object_store_get",
            "object_store_commit",
            "note_files_dispatch",
            "load_user_paper_artifact",
        ] {
            assert!(recovery_command(command));
        }
    }
    #[test]
    fn one_process_owns_each_recovery_profile_until_exit() {
        let root = std::env::temp_dir().join(format!(
            "liteasy-profile-lock-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let first = lock_profile(&root).unwrap();
        assert!(lock_profile(&root).is_err());
        drop(first);
        drop(lock_profile(&root).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn browser_directory_is_owned_and_reusable() {
        let root = std::env::temp_dir().join(format!(
            "liteasy-browser-profile-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let directory = recovery_webview_directory(&root).unwrap();
        std::fs::write(directory.join("fixture"), b"preserved").unwrap();
        assert_eq!(recovery_webview_directory(&root).unwrap(), directory);
        assert_eq!(
            std::fs::read(directory.join("fixture")).unwrap(),
            b"preserved"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn browser_directory_cannot_alias_another_profile() {
        let root = std::env::temp_dir().join(format!(
            "liteasy-browser-link-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let original = root.join("original");
        std::fs::create_dir(&original).unwrap();
        std::fs::write(original.join("fixture"), b"untouched").unwrap();
        std::os::unix::fs::symlink(&original, root.join("webview")).unwrap();
        assert!(recovery_webview_directory(&root).is_err());
        assert_eq!(
            std::fs::read(original.join("fixture")).unwrap(),
            b"untouched"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
