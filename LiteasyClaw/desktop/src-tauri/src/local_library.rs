use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const INDEX_FILE_NAME: &str = ".liteasy-library-index.json";
const PROFILE_MARKER_FILE_NAME: &str = ".liteasy-library-profile";
/// Where per-paper artifacts (annotations, anchors, full text) live, relative to the
/// library root. Shared with `user_paper_store` so they travel with the library when its
/// root moves instead of being stranded at the old location.
pub(crate) const ARTIFACTS_DIRECTORY_NAME: &str = "paper-artifacts";
/// The chosen root cannot be recorded inside the library — it is what says where the
/// library is. So it sits beside it, in the app's own data directory.
const ROOT_SETTING_FILE_NAME: &str = "library-root.json";
pub(crate) const MAX_PDF_BYTES: u64 = 256 * 1024 * 1024;

fn normalized_account_key(account_key: Option<&str>) -> String {
    let value = account_key.unwrap_or("guest").trim();
    if value.is_empty() {
        "guest".to_string()
    } else {
        value.to_string()
    }
}

pub(crate) fn account_namespace(account_key: Option<&str>) -> String {
    hash_text(&normalized_account_key(account_key))[..24].to_string()
}

fn claim_library_root(root: &Path, account_key: Option<&str>) -> Result<(), String> {
    let expected = account_namespace(account_key);
    let marker = root.join(PROFILE_MARKER_FILE_NAME);
    if marker.exists() {
        let actual = fs::read_to_string(&marker)
            .map_err(|error| format!("Could not read the library account marker: {error}"))?;
        if actual.trim() != expected {
            return Err(
                "This folder is already assigned to another local account profile.".to_string(),
            );
        }
        return Ok(());
    }
    fs::write(marker, expected)
        .map_err(|error| format!("Could not claim the library folder for this account: {error}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryEntry {
    pub id: String,
    /// `None` for an entry with no body on disk — a paper we can list and cite but not
    /// open, which is all a non-open-access record can ever be.
    pub path: Option<String>,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibrarySnapshot {
    pub entries: Vec<LocalLibraryEntry>,
    pub root_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateLocalPdf {
    pub content_hash: String,
    pub existing_document_ids: Vec<String>,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryImportResult {
    pub duplicates: Vec<DuplicateLocalPdf>,
    pub snapshot: LocalLibrarySnapshot,
    pub status: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryIndex {
    entries: Vec<LocalLibraryIndexEntry>,
    /// Entries the index owns outright: there is no file to rediscover by scanning, so
    /// losing these would lose the user's record of the paper.
    #[serde(default)]
    metadata_only: Vec<MetadataOnlyEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataOnlyEntry {
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    doi: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    external_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryIndexEntry {
    id: String,
    relative_path: String,
    /// sha256 of the file's bytes. Recorded so a rescan does not re-hash, and so an id
    /// can be regenerated identically if the index is ever lost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_hash: Option<String>,
    /// Cheap change detector: a differing size means the body changed and needs re-hashing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_size: Option<u64>,
}

/// One paper body, one id, wherever the body currently sits. The desktop cache derives
/// the same id from the same fingerprint, so promoting a cached paper into the library
/// keeps its identity — and therefore its annotations and anchor index.
pub(crate) fn content_paper_id(content_hash: &str) -> String {
    format!("paper-{}", content_hash.trim().to_ascii_lowercase())
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// A paper we can list but never open has no body to fingerprint, so its identity comes
/// from the strongest external identifier available. Dragging the same non-open-access
/// record in twice therefore lands on one entry, not two.
fn metadata_only_entry_id(doi: Option<&str>, external_url: Option<&str>, title: &str) -> String {
    let identity = match (doi, external_url) {
        (Some(doi), _) => format!("doi:{}", doi.trim().to_ascii_lowercase()),
        (None, Some(url)) => format!("url:{}", url.trim()),
        (None, None) => format!("title:{}", title.trim().to_lowercase()),
    };
    format!("entry-{}", hash_text(&identity))
}

fn hash_file_contents(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("无法读取 PDF 以计算指纹：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("计算 PDF 指纹失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPdfFile {
    bytes: Vec<u8>,
    name: String,
}

fn migrate_legacy_library_if_needed(legacy_root: &Path, root: &Path) -> Result<(), String> {
    let legacy_papers = legacy_root.join("papers");
    let destination_papers = root.join("papers");
    if destination_papers.exists() || !legacy_papers.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    fs::rename(&legacy_papers, &destination_papers)
        .map_err(|error| format!("Could not migrate the legacy user library: {error}"))?;

    let legacy_index = legacy_root.join(INDEX_FILE_NAME);
    let destination_index = root.join(INDEX_FILE_NAME);
    if legacy_index.is_file() && !destination_index.exists() {
        if let Err(error) = fs::rename(&legacy_index, &destination_index) {
            let rollback = fs::rename(&destination_papers, &legacy_papers);
            return Err(match rollback {
                Ok(_) => format!("Could not migrate the legacy library index; PDF migration was rolled back: {error}"),
                Err(rollback_error) => format!(
                    "Could not migrate the legacy library index and PDF migration rollback failed: {error}; rollback error: {rollback_error}"
                ),
            });
        }
    }
    Ok(())
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryRootSetting {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    root_path: Option<String>,
}

fn root_setting_path(app: &AppHandle, account_key: Option<&str>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| {
            directory
                .join("library-profiles")
                .join(account_namespace(account_key))
                .join(ROOT_SETTING_FILE_NAME)
        })
        .map_err(|error| {
            format!("Could not determine the current user's app data directory: {error}")
        })
}

fn read_root_override(
    app: &AppHandle,
    account_key: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let path = root_setting_path(app, account_key)?;
    if !path.is_file() {
        return Ok(None);
    }
    let serialized =
        fs::read_to_string(&path).map_err(|error| format!("无法读取文献库根目录设置：{error}"))?;
    let setting: LibraryRootSetting = serde_json::from_str(&serialized)
        .map_err(|error| format!("文献库根目录设置损坏：{error}"))?;
    Ok(setting
        .root_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from))
}

fn write_root_override(
    app: &AppHandle,
    root: &Path,
    account_key: Option<&str>,
) -> Result<(), String> {
    let path = root_setting_path(app, account_key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    }
    let serialized = serde_json::to_string_pretty(&LibraryRootSetting {
        root_path: Some(root.to_string_lossy().to_string()),
    })
    .map_err(|error| error.to_string())?;
    fs::write(&path, serialized).map_err(|error| format!("无法保存文献库根目录设置：{error}"))
}

fn default_library_root(app: &AppHandle, account_key: Option<&str>) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|error| {
        format!("Could not determine the current user's app data directory: {error}")
    })?;
    let legacy_app_library = app_data.join("user-library");
    let root = legacy_app_library
        .join("profiles")
        .join(account_namespace(account_key));
    migrate_legacy_library_if_needed(&legacy_app_library, &root)?;
    // The pre-platform-directory location is only ever migrated into the default root.
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        migrate_legacy_library_if_needed(&PathBuf::from(home).join("LiteasyLibrary"), &root)?;
    }
    Ok(root)
}

pub(crate) fn library_root(app: &AppHandle, account_key: Option<&str>) -> Result<PathBuf, String> {
    let root = match read_root_override(app, account_key)? {
        Some(configured) => configured,
        None => default_library_root(app, account_key)?,
    };
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    claim_library_root(&root, account_key)?;
    fs::create_dir_all(root.join("papers")).map_err(|error| error.to_string())?;
    root.canonicalize().map_err(|error| error.to_string())
}

fn copy_directory(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| format!("无法创建目标目录：{error}"))?;
    for entry in fs::read_dir(from).map_err(|error| format!("无法读取源目录：{error}"))? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = to.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)
                .map(|_| ())
                .map_err(|error| format!("复制文件失败：{error}"))?;
        }
    }
    Ok(())
}

/// Renaming is the fast path; a new root on a different drive needs a real copy.
fn move_path(from: &Path, to: &Path) -> Result<(), String> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    if from.is_dir() {
        copy_directory(from, to)?;
        fs::remove_dir_all(from).map_err(|error| format!("无法清理迁移后的旧目录：{error}"))
    } else {
        fs::copy(from, to).map_err(|error| format!("复制文件失败：{error}"))?;
        fs::remove_file(from).map_err(|error| format!("无法清理迁移后的旧文件：{error}"))
    }
}

/// Moves the library to a new root. Everything the library owns goes together — leaving
/// any of it behind would split the library in two, with annotations pointing at papers
/// that are no longer listed.
#[tauri::command]
pub fn set_local_library_root(
    app: AppHandle,
    next_root_path: String,
    account_key: Option<String>,
) -> Result<LocalLibrarySnapshot, String> {
    let requested = PathBuf::from(next_root_path.trim());
    if requested.as_os_str().is_empty() || !requested.is_absolute() {
        return Err("请提供文献库根目录的完整路径。".to_string());
    }
    fs::create_dir_all(&requested).map_err(|error| format!("无法创建目标文献库目录：{error}"))?;
    let target = requested
        .canonicalize()
        .map_err(|error| format!("无法访问目标文献库目录：{error}"))?;
    let current = library_root(&app, account_key.as_deref())?;
    if target == current {
        return load_local_library_snapshot(app, account_key);
    }
    if target.starts_with(&current) {
        return Err("新的文献库根目录不能位于当前文献库内部。".to_string());
    }
    if current.starts_with(&target) {
        return Err("新的文献库根目录不能是当前文献库的上层目录。".to_string());
    }

    if target.join(PROFILE_MARKER_FILE_NAME).exists() {
        claim_library_root(&target, account_key.as_deref())?;
    }

    let owned_names = ["papers", ARTIFACTS_DIRECTORY_NAME, INDEX_FILE_NAME];
    for name in owned_names {
        if target.join(name).exists() {
            return Err(format!(
                "目标目录中已存在 {name}，请先清空该目录或另选位置。"
            ));
        }
    }

    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for name in owned_names {
        let from = current.join(name);
        if !from.exists() {
            continue;
        }
        let to = target.join(name);
        if let Err(error) = move_path(&from, &to) {
            // Put back whatever already moved, so a failed change leaves one intact library.
            for (moved_from, moved_to) in moved.iter().rev() {
                let _ = move_path(moved_to, moved_from);
            }
            return Err(format!("迁移文献库失败，已尝试回滚：{error}"));
        }
        moved.push((from, to));
    }

    if let Err(error) = write_root_override(&app, &target, account_key.as_deref()) {
        let mut rollback_errors = Vec::new();
        for (moved_from, moved_to) in moved.iter().rev() {
            if let Err(rollback_error) = move_path(moved_to, moved_from) {
                rollback_errors.push(rollback_error);
            }
        }
        return Err(if rollback_errors.is_empty() {
            format!("无法保存新的文献库位置，文件迁移已回滚：{error}")
        } else {
            format!(
                "无法保存新的文献库位置，且文件迁移未能完整回滚：{error}；回滚错误：{}",
                rollback_errors.join("；")
            )
        });
    }
    load_local_library_snapshot(app, account_key)
}

#[tauri::command]
pub fn open_local_library_in_file_manager(
    app: AppHandle,
    account_key: Option<String>,
) -> Result<(), String> {
    let root = library_root(&app, account_key.as_deref())?;
    let program = if cfg!(target_os = "windows") {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(&root)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开文件管理器：{error}"))
}

/// The directory every imported or promoted paper body lands in. Shared with the
/// paper cache so a promoted paper follows exactly the same import path as an upload.
pub(crate) fn library_papers_directory(
    app: &AppHandle,
    account_key: Option<&str>,
) -> Result<PathBuf, String> {
    let papers = library_root(app, account_key)?.join("papers");
    fs::create_dir_all(&papers).map_err(|error| format!("无法创建文献库目录：{error}"))?;
    papers
        .canonicalize()
        .map_err(|error| format!("无法访问文献库目录：{error}"))
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
    fs::rename(&temporary_path, &path)
        .or_else(|_| {
            fs::write(&path, fs::read(&temporary_path)?)?;
            fs::remove_file(&temporary_path)
        })
        .map_err(|error| error.to_string())
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
pub fn load_local_library_snapshot(
    app: AppHandle,
    account_key: Option<String>,
) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app, account_key.as_deref())?;
    let mut pdf_paths = Vec::new();
    collect_pdf_paths(&root, &mut pdf_paths)?;
    pdf_paths.sort();

    let existing_index = read_index(&root)?;
    // Scanning only rediscovers files, so these have to be carried across the rewrite.
    let metadata_only = existing_index.metadata_only;
    let stored_by_path: HashMap<String, LocalLibraryIndexEntry> = existing_index
        .entries
        .into_iter()
        .map(|entry| (entry.relative_path.clone(), entry))
        .collect();
    let mut used_ids = HashSet::new();
    let mut next_index = LocalLibraryIndex::default();
    let mut entries = Vec::new();

    for (sequence, path) in pdf_paths.into_iter().enumerate() {
        let relative = relative_path(&root, &path)?;
        let file_size = fs::metadata(&path).map(|data| data.len()).ok();
        let stored = stored_by_path.get(&relative);

        // Hashing every file on every scan would make opening a large library slow, so
        // reuse the recorded fingerprint whenever the size still matches.
        let reused_hash = match (stored, file_size) {
            (Some(entry), Some(size)) if entry.file_size == Some(size) => {
                entry.content_hash.clone()
            }
            _ => None,
        };
        let content_hash = match reused_hash {
            Some(hash) => Some(hash),
            None => hash_file_contents(&path).ok(),
        };

        // An id already handed out never changes: annotations and anchor indexes are
        // keyed by it, so re-deriving it would orphan the user's work.
        let base_id = match stored {
            Some(entry) => entry.id.clone(),
            // documentId identifies one logical copy. It must stay independent from the
            // content hash so byte-identical files can keep separate annotations/lifecycles.
            None => next_entry_id(sequence),
        };
        let mut id = base_id.clone();
        let mut duplicate = 2usize;
        while used_ids.contains(&id) {
            // Two byte-identical copies on disk: keep both files, keep ids unique.
            id = format!("{base_id}-{duplicate}");
            duplicate += 1;
        }
        used_ids.insert(id.clone());
        next_index.entries.push(LocalLibraryIndexEntry {
            content_hash,
            file_size,
            id: id.clone(),
            relative_path: relative,
        });
        entries.push(LocalLibraryEntry {
            id,
            path: Some(path.to_string_lossy().to_string()),
            title: path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled PDF")
                .to_string(),
        });
    }

    for entry in &metadata_only {
        if used_ids.contains(&entry.id) {
            continue;
        }
        used_ids.insert(entry.id.clone());
        entries.push(LocalLibraryEntry {
            id: entry.id.clone(),
            path: None,
            title: entry.title.clone(),
        });
    }
    next_index.metadata_only = metadata_only;

    write_index(&root, &next_index)?;
    Ok(LocalLibrarySnapshot {
        entries,
        root_path: root.to_string_lossy().to_string(),
    })
}

/// Records a paper we can list but not open — the only thing a non-open-access result can
/// become. It deliberately produces no body, so the reader must show "entry only" rather
/// than pretend the full text is one click away.
#[tauri::command]
pub fn add_metadata_only_library_entry(
    app: AppHandle,
    title: String,
    doi: Option<String>,
    external_url: Option<String>,
    source_id: Option<String>,
    account_key: Option<String>,
) -> Result<LocalLibrarySnapshot, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("条目标题不能为空。".to_string());
    }
    let doi = non_empty(doi);
    let external_url = non_empty(external_url);
    let root = library_root(&app, account_key.as_deref())?;
    let mut index = read_index(&root)?;
    let id = metadata_only_entry_id(doi.as_deref(), external_url.as_deref(), &title);
    if !index.metadata_only.iter().any(|entry| entry.id == id) {
        index.metadata_only.push(MetadataOnlyEntry {
            doi,
            external_url,
            id,
            source_id: non_empty(source_id),
            title,
        });
        write_index(&root, &index)?;
    }
    load_local_library_snapshot(app, account_key)
}

fn resolve_import_directory(
    root: &Path,
    requested_path: Option<String>,
) -> Result<PathBuf, String> {
    let directory = match requested_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => root.join("papers"),
    };
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建导入目录：{error}"))?;
    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("无法访问导入目录：{error}"))?;
    if !canonical.starts_with(root) {
        return Err("导入目录必须位于本地文献库中。".to_string());
    }
    Ok(canonical)
}

pub(crate) fn unique_pdf_target(directory: &Path, requested_name: &str) -> Result<PathBuf, String> {
    let source_name = Path::new(requested_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "PDF 文件名无效。".to_string())?;
    let source_path = Path::new(source_name);
    if !source_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("只能导入 PDF 文件。".to_string());
    }
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled PDF");
    let mut sequence = 1usize;
    loop {
        let name = if sequence == 1 {
            format!("{stem}.pdf")
        } else {
            format!("{stem} ({sequence}).pdf")
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
        sequence += 1;
    }
}

#[tauri::command]
pub fn import_local_library_pdfs(
    app: AppHandle,
    files: Vec<ImportedPdfFile>,
    target_folder_path: Option<String>,
    account_key: Option<String>,
    duplicate_action: Option<String>,
) -> Result<LocalLibraryImportResult, String> {
    if files.is_empty() {
        return Err("没有可导入的 PDF 文件。".to_string());
    }
    let snapshot = load_local_library_snapshot(app.clone(), account_key.clone())?;
    let root = library_root(&app, account_key.as_deref())?;
    let directory = resolve_import_directory(&root, target_folder_path)?;
    let index = read_index(&root)?;
    let mut document_ids_by_hash: HashMap<String, Vec<String>> = HashMap::new();
    for entry in &index.entries {
        if let Some(content_hash) = &entry.content_hash {
            document_ids_by_hash
                .entry(content_hash.clone())
                .or_default()
                .push(entry.id.clone());
        }
    }
    let mut prepared = Vec::new();
    let mut duplicates = Vec::new();
    for file in files {
        if file.bytes.is_empty() {
            return Err(format!("PDF 文件为空：{}", file.name));
        }
        if !file.bytes.starts_with(b"%PDF-") {
            return Err(format!("The imported file is not a PDF: {}", file.name));
        }
        if file.bytes.len() as u64 > MAX_PDF_BYTES {
            return Err(format!("The imported PDF exceeds 256 MB: {}", file.name));
        }
        let content_hash = hash_bytes(&file.bytes);
        if let Some(existing_document_ids) = document_ids_by_hash.get(&content_hash) {
            duplicates.push(DuplicateLocalPdf {
                content_hash,
                existing_document_ids: existing_document_ids.clone(),
                name: file.name.clone(),
            });
        }
        prepared.push(file);
    }

    let action = duplicate_action.as_deref().unwrap_or("");
    if !duplicates.is_empty() && action != "save_copy" {
        if !action.is_empty() && action != "cancel" {
            return Err("Duplicate action must be save_copy or cancel.".to_string());
        }
        return Ok(LocalLibraryImportResult {
            duplicates,
            snapshot,
            status: if action == "cancel" {
                "cancelled"
            } else {
                "duplicate"
            }
            .to_string(),
        });
    }

    for file in prepared {
        let target = unique_pdf_target(&directory, &file.name)?;
        fs::write(&target, file.bytes).map_err(|error| format!("写入 PDF 失败：{error}"))?;
    }
    Ok(LocalLibraryImportResult {
        duplicates,
        snapshot: load_local_library_snapshot(app, account_key)?,
        status: "imported".to_string(),
    })
}

fn remap_legacy_resource_path(root: &Path, requested_path: &str) -> PathBuf {
    let requested = PathBuf::from(requested_path);
    if requested.exists() {
        return requested;
    }
    let legacy_root = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join("LiteasyLibrary"));
    legacy_root
        .and_then(|legacy| {
            requested
                .strip_prefix(legacy)
                .ok()
                .map(|relative| root.join(relative))
        })
        .unwrap_or(requested)
}

fn resolve_existing_resource(root: &Path, requested_path: &str) -> Result<PathBuf, String> {
    let path = remap_legacy_resource_path(root, requested_path);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("找不到源资源：{error}"))?;
    if canonical == root || !canonical.starts_with(root) {
        return Err("只能修改本地文献库根目录内的资源。".to_string());
    }
    Ok(canonical)
}

#[tauri::command]
pub fn read_local_library_pdf(
    app: AppHandle,
    source_path: String,
    account_key: Option<String>,
) -> Result<Vec<u8>, String> {
    let root = library_root(&app, account_key.as_deref())?;
    let source = resolve_existing_resource(&root, &source_path)?;
    if !source.is_file()
        || !source
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("只能读取本地文献库中的 PDF 文件。".to_string());
    }
    let size = fs::metadata(&source)
        .map_err(|error| format!("无法读取 PDF 文件信息：{error}"))?
        .len();
    if size == 0 {
        return Err("PDF 文件为空。".to_string());
    }
    if size > MAX_PDF_BYTES {
        return Err("PDF 文件超过 256 MB，无法导入。".to_string());
    }
    fs::read(source).map_err(|error| format!("读取 PDF 失败：{error}"))
}

fn resolve_target_resource(root: &Path, requested_path: &str) -> Result<PathBuf, String> {
    let path = remap_legacy_resource_path(root, requested_path);
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
pub fn move_local_library_resource(
    app: AppHandle,
    source_path: String,
    target_path: String,
    account_key: Option<String>,
) -> Result<(), String> {
    let root = library_root(&app, account_key.as_deref())?;
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
            Err(rollback_error) => {
                format!("索引更新失败，且磁盘移动无法自动回滚：{error}；回滚错误：{rollback_error}")
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{account_namespace, content_paper_id, metadata_only_entry_id, non_empty};

    #[test]
    fn derives_one_stable_id_per_paper_body() {
        let hash = "ABCDEF0123456789".repeat(4);
        let lowercased = hash.to_ascii_lowercase();
        assert_eq!(content_paper_id(&hash), format!("paper-{lowercased}"));
        // The cache and the library must agree, so casing and padding cannot matter.
        assert_eq!(
            content_paper_id(&hash),
            content_paper_id(&format!("  {lowercased} "))
        );
    }

    #[test]
    fn identifies_bodyless_entries_by_their_strongest_external_identifier() {
        let by_doi = metadata_only_entry_id(Some("10.1000/Example"), Some("https://a"), "A title");
        // Same DOI in different casing is the same paper, whatever the URL or title say.
        assert_eq!(
            by_doi,
            metadata_only_entry_id(Some("  10.1000/example  "), Some("https://b"), "B title")
        );
        assert!(by_doi.starts_with("entry-"));

        // Without a DOI the URL decides, and without either the title does.
        assert_eq!(
            metadata_only_entry_id(None, Some("https://a"), "A"),
            metadata_only_entry_id(None, Some("https://a"), "B")
        );
        assert_ne!(
            metadata_only_entry_id(None, None, "A"),
            metadata_only_entry_id(None, None, "B")
        );
    }

    #[test]
    fn treats_blank_identifiers_as_absent() {
        assert_eq!(non_empty(Some("  ".to_string())), None);
        assert_eq!(
            non_empty(Some(" 10.1 ".to_string())),
            Some("10.1".to_string())
        );
        assert_eq!(non_empty(None), None);
    }

    #[test]
    fn isolates_local_library_namespaces_by_account() {
        assert_ne!(
            account_namespace(Some("user:alice")),
            account_namespace(Some("user:bob"))
        );
        assert_eq!(account_namespace(None), account_namespace(Some("guest")));
    }
}
