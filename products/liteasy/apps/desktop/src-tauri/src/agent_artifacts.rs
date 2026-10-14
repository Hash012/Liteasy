use crate::local_library::{artifacts_directory, library_root, write_bytes_atomically};
use crate::user_paper_store::paper_artifact_directory_name;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

static SAVE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
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
    let _guard = SAVE_LOCK.lock().map_err(|_| "产物存储锁不可用")?;
    let id = document["artifactId"].as_str().ok_or("产物标识缺失。")?;
    validate_id(id)?;
    let research = document["artifactType"] == "research_document";
    let paper_id = if research {
        let invocation = &document["researchDocument"]["invocation"];
        if document["researchDocument"]["schema"] != "liteasy.research-document/v1"
            || invocation["destination"]["scopeId"] != invocation["scopeId"]
            || invocation["requestId"] != document["agent"]["runId"]
        {
            return Err("科研文档归属或任务标识无效".into());
        }
        Some(
            invocation["destination"]["paperId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or("科研文档缺少保存目标")?,
        )
    } else {
        document["papers"][0]["id"].as_str()
    };
    if document["version"] != "liteasy.agent-artifact/v1"
        || document["agent"]["status"] != "completed"
    {
        return Err("只能保存完整的结构化产物。".into());
    }
    let directory = root.join(match paper_id {
        Some(id) => paper_artifact_directory_name(id)?,
        None => "workspace-artifacts".to_string(),
    });
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
    // Check the global id, including a changed owner directory, under one IPC write lock.
    for existing in files(root)? {
        if existing.file_stem().and_then(|s| s.to_str()) == Some(id) {
            let previous = read(&existing)?;
            if research || previous["artifactType"] == "research_document" {
                if previous != *document {
                    return Err("科研文档版本已保存，不能覆盖".into());
                }
                return Ok(existing.to_string_lossy().into_owned());
            }
        }
    }
    write_bytes_atomically(&path, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn list_local_agent_artifacts(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(files(&artifacts_directory(&library_root(&app)?))?
        .iter()
        .map(|path| {
            read(path).unwrap_or_else(|error| {
                serde_json::json!({
                    "artifactId": path.file_stem().and_then(|name| name.to_str()),
                    "readError": error
                })
            })
        })
        .collect())
}
pub(crate) fn locate(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    files(&artifacts_directory(&library_root(app)?))?
        .into_iter()
        .find(|path| path.file_stem().and_then(|s| s.to_str()) == Some(id))
        .ok_or_else(|| "本地产物文件不可用。".into())
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
    fn research_documents_use_explicit_owner_and_refuse_conflicting_overwrites() {
        let root =
            std::env::temp_dir().join(format!("liteasy-research-artifacts-{}", std::process::id()));
        let mut document = serde_json::json!({"version":"liteasy.agent-artifact/v1","artifactId":"research-run-one","artifactType":"research_document","papers":[{"id":"source-A"}],"agent":{"status":"completed","runId":"run-one"},"researchDocument":{"schema":"liteasy.research-document/v1","invocation":{"requestId":"run-one","scopeId":"scope","destination":{"paperId":"owner-B","scopeId":"scope"}}}});
        let path = PathBuf::from(save(&root, &document).unwrap());
        assert!(path.starts_with(root.join(paper_artifact_directory_name("owner-B").unwrap())));
        assert_eq!(save(&root, &document).unwrap(), path.to_string_lossy());
        document["answer"] = "changed".into();
        assert!(save(&root, &document).is_err());
        document["researchDocument"]["invocation"]["destination"]["paperId"] = "owner-C".into();
        assert!(save(&root, &document).is_err());
        assert_eq!(files(&root).unwrap(), vec![path]);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stores_artifacts_created_from_notes_without_a_source_paper() {
        let root = std::env::temp_dir().join(format!(
            "liteasy-workspace-artifacts-{}",
            std::process::id()
        ));
        let document = serde_json::json!({"version":"liteasy.agent-artifact/v1","artifactId":"slides-from-notes","papers":[],"agent":{"status":"completed"},"answer":"slides"});
        let path = PathBuf::from(save(&root, &document).unwrap());
        assert_eq!(
            path,
            root.join("workspace-artifacts/agent-results/slides-from-notes.json")
        );
        assert_eq!(read(&path).unwrap(), document);
        assert_eq!(files(&root).unwrap(), vec![path]);
        fs::remove_dir_all(root).unwrap();
    }
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
