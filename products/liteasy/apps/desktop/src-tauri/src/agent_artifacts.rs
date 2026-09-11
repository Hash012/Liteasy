use crate::local_library::{artifacts_directory, library_root, write_bytes_atomically};
use crate::user_paper_store::paper_artifact_directory_name;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

const MAX_BYTES: u64 = 32 * 1024 * 1024;
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 120
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        || id == "."
        || id == ".."
    {
        return Err("产物标识无效。".into());
    }
    Ok(())
}
fn files(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut paths = vec![];
    for paper in fs::read_dir(root).map_err(|e| e.to_string())? {
        let paper = paper.map_err(|e| e.to_string())?;
        if !paper.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let results = paper.path().join("agent-results");
        if !results.exists()
            || fs::symlink_metadata(&results)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
        {
            continue;
        }
        for entry in fs::read_dir(results).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_file()
                && entry.path().extension().is_some_and(|ext| ext == "json")
            {
                paths.push(entry.path());
            }
        }
    }
    paths.sort();
    Ok(paths)
}
fn read(path: &Path) -> Result<Value, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("产物超过大小限制。".into());
    }
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("本地产物损坏，文件已保留：{e}"))?;
    if value["version"] != "liteasy.agent-artifact/v1" {
        return Err("本地产物版本无效。".into());
    }
    Ok(value)
}
fn save(root: &Path, document: &Value) -> Result<String, String> {
    let id = document["artifactId"].as_str().ok_or("产物标识缺失。")?;
    validate_id(id)?;
    let paper_id = document["papers"][0]["id"]
        .as_str()
        .ok_or("产物缺少来源论文。")?;
    if document["version"] != "liteasy.agent-artifact/v1"
        || document["agent"]["status"] != "completed"
    {
        return Err("只能保存完整的结构化产物。".into());
    }
    let directory = root.join(paper_artifact_directory_name(paper_id)?);
    let result_dir = directory.join("agent-results");
    for path in [&directory, &result_dir] {
        if path.exists()
            && fs::symlink_metadata(path)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("产物目录不能是符号链接。".into());
        }
    }
    let path = result_dir.join(format!("{id}.json"));
    let bytes = serde_json::to_vec_pretty(document).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("产物超过大小限制。".into());
    }
    write_bytes_atomically(&path, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn list_local_agent_artifacts(app: AppHandle) -> Result<Vec<Value>, String> {
    files(&artifacts_directory(&library_root(&app)?))?
        .iter()
        .map(|path| read(path))
        .collect()
}
#[tauri::command]
pub fn save_local_agent_artifact(app: AppHandle, document: Value) -> Result<String, String> {
    save(&artifacts_directory(&library_root(&app)?), &document)
}
#[tauri::command]
pub fn delete_local_agent_artifact(app: AppHandle, artifact_id: String) -> Result<(), String> {
    validate_id(&artifact_id)?;
    for path in files(&artifacts_directory(&library_root(&app)?))? {
        if path.file_stem().and_then(|s| s.to_str()) == Some(&artifact_id) {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trips_paper_bound_extensible_artifacts_and_replaces_them() {
        let root =
            std::env::temp_dir().join(format!("liteasy-agent-artifacts-{}", std::process::id()));
        let mut document = serde_json::json!({"version":"liteasy.agent-artifact/v1","artifactId":"thin-reading-1","papers":[{"id":"C:\\论文库\\论文.pdf"}],"agent":{"status":"completed"},"thinReadingDocument":{"extensions":{"custom":{"value":42}}}});
        let path = PathBuf::from(save(&root, &document).unwrap());
        document["title"] = "更新后的薄读".into();
        save(&root, &document).unwrap();
        assert_eq!(files(&root).unwrap(), vec![path.clone()]);
        assert_eq!(read(&path).unwrap(), document);
        assert_eq!(path.parent().unwrap().file_name().unwrap(), "agent-results");
        document["artifactId"] = "../../escape".into();
        assert!(save(&root, &document).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
