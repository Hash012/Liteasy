use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const INDEX_FILE_NAME: &str = ".liteasy-library-index.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryEntry {
    pub id: String,
    pub path: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibrarySnapshot {
    pub entries: Vec<LocalLibraryEntry>,
    pub root_path: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryIndex {
    entries: Vec<LocalLibraryIndexEntry>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryIndexEntry {
    id: String,
    relative_path: String,
}

fn library_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "无法确定用户主目录。".to_string())?;
    let root = PathBuf::from(home).join("LiteasyLibrary");
    fs::create_dir_all(root.join("papers")).map_err(|error| error.to_string())?;
    root.canonicalize().map_err(|error| error.to_string())
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "资源不在本地文献库中。".to_string())
}

fn read_index(root: &Path) -> Result<LocalLibraryIndex, String> {
    let path = root.join(INDEX_FILE_NAME);
    if !path.exists() {
        return Ok(LocalLibraryIndex::default());
    }
    let serialized = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&serialized)
        .map_err(|error| format!("本地文献库索引损坏，已停止修改以保护现有数据：{error}"))
}

fn write_index(root: &Path, index: &LocalLibraryIndex) -> Result<(), String> {
    let path = root.join(INDEX_FILE_NAME);
    let temporary_path = root.join(format!("{INDEX_FILE_NAME}.tmp"));
    let serialized = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    fs::write(&temporary_path, serialized).map_err(|error| error.to_string())?;
    fs::rename(&temporary_path, &path).or_else(|_| {
        fs::write(&path, fs::read(&temporary_path)?)?;
        fs::remove_file(&temporary_path)
    }).map_err(|error| error.to_string())
}

fn collect_pdf_paths(directory: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            collect_pdf_paths(&entry.path(), paths)?;
        } else if file_type.is_file()
            && entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
        {
            paths.push(entry.path());
        }
    }
    Ok(())
}

fn next_entry_id(sequence: usize) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("local-{timestamp}-{sequence}")
}

#[tauri::command]
pub fn load_local_library_snapshot() -> Result<LocalLibrarySnapshot, String> {
    let root = library_root()?;
    let mut pdf_paths = Vec::new();
    collect_pdf_paths(&root, &mut pdf_paths)?;
    pdf_paths.sort();

    let existing_index = read_index(&root)?;
    let ids_by_path: HashMap<_, _> = existing_index
        .entries
        .into_iter()
        .map(|entry| (entry.relative_path, entry.id))
        .collect();
    let mut used_ids = HashSet::new();
    let mut next_index = LocalLibraryIndex::default();
    let mut entries = Vec::new();

    for (sequence, path) in pdf_paths.into_iter().enumerate() {
        let relative = relative_path(&root, &path)?;
        let mut id = ids_by_path
            .get(&relative)
            .cloned()
            .unwrap_or_else(|| next_entry_id(sequence));
        while used_ids.contains(&id) {
            id = next_entry_id(sequence + used_ids.len());
        }
        used_ids.insert(id.clone());
        next_index.entries.push(LocalLibraryIndexEntry {
            id: id.clone(),
            relative_path: relative,
        });
        entries.push(LocalLibraryEntry {
            id,
            path: path.to_string_lossy().to_string(),
            title: path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled PDF")
                .to_string(),
        });
    }

    write_index(&root, &next_index)?;
    Ok(LocalLibrarySnapshot {
        entries,
        root_path: root.to_string_lossy().to_string(),
    })
}

fn resolve_existing_resource(root: &Path, requested_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(requested_path);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("找不到源资源：{error}"))?;
    if canonical == root || !canonical.starts_with(root) {
        return Err("只能修改本地文献库根目录内的资源。".to_string());
    }
    Ok(canonical)
}

fn resolve_target_resource(root: &Path, requested_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(requested_path);
    let file_name = path
        .file_name()
        .ok_or_else(|| "目标名称无效。".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "目标目录无效。".to_string())?
        .canonicalize()
        .map_err(|error| format!("找不到目标目录：{error}"))?;
    if !parent.starts_with(root) {
        return Err("目标目录必须位于本地文献库中。".to_string());
    }
    let target = parent.join(file_name);
    if target.exists() {
        return Err("目标位置已经存在同名资源。".to_string());
    }
    Ok(target)
}

#[tauri::command]
pub fn move_local_library_resource(source_path: String, target_path: String) -> Result<(), String> {
    let root = library_root()?;
    let source = resolve_existing_resource(&root, &source_path)?;
    let target = resolve_target_resource(&root, &target_path)?;
    if source.is_dir() && target.starts_with(&source) {
        return Err("不能把目录移动到自身或其子目录中。".to_string());
    }

    let source_relative = relative_path(&root, &source)?;
    let target_relative = relative_path(&root, &target)?;
    fs::rename(&source, &target).map_err(|error| format!("移动磁盘资源失败：{error}"))?;

    let update_result = (|| -> Result<(), String> {
        let mut index = read_index(&root)?;
        for entry in &mut index.entries {
            if entry.relative_path == source_relative {
                entry.relative_path = target_relative.clone();
            } else if let Some(suffix) = entry
                .relative_path
                .strip_prefix(&format!("{source_relative}/"))
            {
                entry.relative_path = format!("{target_relative}/{suffix}");
            }
        }
        write_index(&root, &index)
    })();

    if let Err(error) = update_result {
        let rollback = fs::rename(&target, &source);
        return Err(match rollback {
            Ok(_) => format!("索引更新失败，磁盘移动已回滚：{error}"),
            Err(rollback_error) => format!(
                "索引更新失败，且磁盘移动无法自动回滚：{error}；回滚错误：{rollback_error}"
            ),
        });
    }
    Ok(())
}
