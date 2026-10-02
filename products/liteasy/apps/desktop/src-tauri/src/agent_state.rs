use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MAX_AGENT_STATE_BYTES: u64 = 10 * 1024 * 1024;

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::data_location::root(&app)
        .map(|directory| directory.join("agent-state.v1.json"))
        .map_err(|error| format!("Could not resolve Agent state directory: {error}"))
}

#[tauri::command]
pub fn load_agent_state(app: AppHandle) -> Result<Option<Value>, String> {
    load(&state_path(&app)?)
}

fn load(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Could not inspect Agent state: {error}"))?;
    if metadata.len() > MAX_AGENT_STATE_BYTES {
        return Err(format!(
            "Agent state exceeds the {} byte limit",
            MAX_AGENT_STATE_BYTES
        ));
    }
    let serialized =
        fs::read(&path).map_err(|error| format!("Could not read Agent state: {error}"))?;
    serde_json::from_slice(&serialized)
        .map(Some)
        .map_err(|error| format!("Stored Agent state is invalid JSON: {error}"))
}

#[tauri::command]
pub fn save_agent_state(app: AppHandle, snapshot: Value) -> Result<(), String> {
    save(&state_path(&app)?, &snapshot)
}

fn save(path: &Path, snapshot: &Value) -> Result<(), String> {
    let supported = |value: &Value| {
        value["version"] == "liteasy.agent-state/v1"
            && value["savedAt"].is_string()
            && value["sessions"].is_array()
            && value["pendingConfirmations"].is_array()
    };
    if !supported(snapshot) {
        return Err("会话格式无效，未覆盖原数据。".into());
    }
    // Older clients may not overwrite a future or unreadable snapshot, even if
    // called directly through IPC. Per-record recovery belongs to the TS reader.
    if load(path)?.is_some_and(|previous| !supported(&previous)) {
        return Err("会话格式不兼容，原数据已保留，请使用兼容版本恢复。".into());
    }
    let serialized = serde_json::to_vec(snapshot)
        .map_err(|error| format!("Could not encode Agent state: {error}"))?;
    if serialized.len() as u64 > MAX_AGENT_STATE_BYTES {
        return Err(format!(
            "Agent state exceeds the {} byte limit",
            MAX_AGENT_STATE_BYTES
        ));
    }
    // Reuse the existing synced temp + atomic publication implementation. On
    // Windows it replaces the destination without first deleting the old file.
    crate::local_library::write_private_bytes_atomically(path, &serialized)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_unsupported_or_corrupt_bytes_and_atomically_replaces_valid_state() {
        let root = std::env::temp_dir().join(format!(
            "liteasy-state-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("中文 state.json");
        let valid = serde_json::json!({"version":"liteasy.agent-state/v1","savedAt":"2026-10-02","sessions":[],"pendingConfirmations":[]});
        for original in [
            b"{ \"version\": \"liteasy.agent-state/v99\", \"future\":true }".as_slice(),
            b"{broken JSON",
        ] {
            fs::write(&path, original).unwrap();
            assert!(save(&path, &valid).is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        fs::remove_file(&path).unwrap();
        save(&path, &valid).unwrap();
        save(&path, &valid).unwrap();
        assert_eq!(load(&path).unwrap(), Some(valid.clone()));
        assert!(save(&path, &serde_json::json!({})).is_err());
        assert_eq!(load(&path).unwrap(), Some(valid));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
