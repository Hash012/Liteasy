use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
fn path(app: &AppHandle, scope: &str) -> Result<PathBuf, String> {
    if !matches!(scope, "artifact-tasks" | "thin-reading" | "paper-services") {
        return Err("未知工作流存储。".into());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{scope}-checkpoints.v1.json")))
}
#[tauri::command]
pub fn load_workflow_checkpoints(app: AppHandle, scope: String) -> Result<Value, String> {
    let path = path(&app, &scope)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 {
        return Err("工作流检查点超过大小限制，已保留原文件。".into());
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&data).map_err(|_| "工作流检查点损坏，已保留原文件。".into())
}
#[tauri::command]
pub fn save_workflow_checkpoints(
    app: AppHandle,
    scope: String,
    snapshot: Value,
) -> Result<(), String> {
    if !snapshot.is_object() {
        return Err("工作流检查点格式无效。".into());
    }
    let bytes = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("工作流检查点存储已满，请整理已完成任务。".into());
    }
    crate::local_library::write_bytes_atomically(&path(&app, &scope)?, &bytes)
}
