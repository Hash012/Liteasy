//! Explicit opt-in development isolation. Release builds ignore the environment.
use std::path::PathBuf;
use std::sync::OnceLock;
static PROFILE: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn initialize() -> Result<(), String> {
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
        ] {
            assert!(!network_or_credential_command(command));
        }
    }
    #[test]
    fn rejects_unmarked_profile() {
        assert!(validate_profile(std::env::temp_dir()).is_err());
    }
}
