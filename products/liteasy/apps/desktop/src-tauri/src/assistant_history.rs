use serde_json::Value;
use std::{fs, path::Path};
use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 32 * 1024 * 1024;

pub(crate) fn load(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_BYTES as u64 {
        return Err("对话历史超过大小限制，请先备份。".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map(Some)
        .map_err(|e| format!("对话历史损坏，原文件已保留：{e}"))
}

pub(crate) fn save(path: &Path, snapshot: &Value) -> Result<(), String> {
    if snapshot["version"] != "liteasy.assistant-history/v1" || !snapshot["sessions"].is_array() {
        return Err("对话历史格式无效。".into());
    }
    let bytes = serde_json::to_vec(snapshot).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("对话历史超过大小限制，请先备份。".into());
    }
    crate::local_library::write_bytes_atomically(path, &bytes)
}

#[tauri::command]
pub fn load_assistant_history(app: AppHandle) -> Result<Option<Value>, String> {
    load(
        &app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("assistant-history.v1.json"),
    )
}

#[tauri::command]
pub fn save_assistant_history(app: AppHandle, snapshot: Value) -> Result<(), String> {
    save(
        &app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("assistant-history.v1.json"),
        &snapshot,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_history_across_repeated_saves_and_rejects_invalid_replacement() {
        let root = std::env::temp_dir().join(format!("liteasy-history-{}", std::process::id()));
        let path = root.join("对话历史.json");
        let first = serde_json::json!({"version":"liteasy.assistant-history/v1","sessions":[{"id":"conversation","messages":[{"content":"你好"}]}]});
        save(&path, &first).unwrap();
        assert_eq!(load(&path).unwrap(), Some(first.clone()));
        let mut next = first;
        next["sessions"][0]["messages"][0]["content"] = "继续阅读".into();
        save(&path, &next).unwrap();
        assert!(save(&path, &serde_json::json!({})).is_err());
        assert_eq!(load(&path).unwrap(), Some(next));
        fs::remove_dir_all(root).unwrap();
    }
}
