use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::user_paper_store::paper_artifact_directory_name;

const LEGACY_INDEX_FILE_NAME: &str = ".liteasy-library-index.json";
const LEGACY_PROFILE_MARKER_FILE_NAME: &str = ".liteasy-library-profile";
const LIBRARY_MARKER_FILE_NAME: &str = ".liteasy-library.json";
const INTERNAL_DIRECTORY_NAME: &str = ".liteasy";
const INDEX_DIRECTORY_NAME: &str = "index";
const INDEX_FILE_NAME: &str = "library-index.v2.json";
const METADATA_ENTRIES_DIRECTORY_NAME: &str = "metadata-entries";
const IMPORT_STAGING_DIRECTORY_NAME: &str = "import-staging";
const IMPORT_STAGING_RETENTION_SECONDS: u64 = 24 * 60 * 60;
const TRASH_DIRECTORY_NAME: &str = "trash";
const TRASH_OPERATION_DIRECTORY_NAME: &str = "trash-operations";
const TRASH_RETENTION_SECONDS: u64 = 30 * 24 * 60 * 60;
/// Where per-paper artifacts (annotations, anchors, full text) live, relative to the
/// library root. Shared with `user_paper_store` so they travel with the library when its
/// root moves instead of being stranded at the old location.
pub(crate) const ARTIFACTS_DIRECTORY_NAME: &str = "paper-artifacts";
/// The chosen root cannot be recorded inside the library — it is what says where the
/// library is. So it sits beside it, in the app's own data directory.
const ROOT_SETTING_FILE_NAME: &str = "library-root.json";
pub(crate) const MAX_PDF_BYTES: u64 = 256 * 1024 * 1024;
const PDF_READ_CHUNK_BYTES: usize = 512 * 1024;

fn normalized_account_key(account_key: Option<&str>) -> String {
    let value = account_key.unwrap_or("guest").trim();
    if value.is_empty() {
        "guest".to_string()
    } else {
        value.to_string()
    }
}

pub(crate) fn legacy_account_namespace(account_key: Option<&str>) -> String {
    hash_text(&normalized_account_key(account_key))[..24].to_string()
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryMarker {
    library_id: String,
    schema_version: u32,
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn ensure_library_marker(root: &Path) -> Result<LibraryMarker, String> {
    let marker_path = root.join(LIBRARY_MARKER_FILE_NAME);
    if marker_path.is_file() {
        let serialized = fs::read_to_string(&marker_path)
            .map_err(|error| format!("无法读取本地文献库标记：{error}"))?;
        let marker: LibraryMarker = serde_json::from_str(&serialized)
            .map_err(|error| format!("本地文献库标记损坏：{error}"))?;
        if marker.library_id.trim().is_empty() || marker.schema_version == 0 {
            return Err("本地文献库标记缺少有效的库标识或版本。".to_string());
        }
        let legacy_marker = root.join(LEGACY_PROFILE_MARKER_FILE_NAME);
        if legacy_marker.is_file() {
            fs::remove_file(legacy_marker)
                .map_err(|error| format!("无法移除旧账号占用标记：{error}"))?;
        }
        return Ok(marker);
    }

    let marker = LibraryMarker {
        library_id: format!(
            "lib_{}",
            &hash_text(&format!("{}:{}", root.to_string_lossy(), unix_timestamp()))[..24]
        ),
        schema_version: 1,
    };
    let serialized = serde_json::to_vec_pretty(&marker).map_err(|error| error.to_string())?;
    write_bytes_atomically(&marker_path, &serialized)?;
    let legacy_marker = root.join(LEGACY_PROFILE_MARKER_FILE_NAME);
    if legacy_marker.is_file() {
        fs::remove_file(legacy_marker)
            .map_err(|error| format!("无法移除旧账号占用标记：{error}"))?;
    }
    Ok(marker)
}

fn legacy_library_marker_backup(root: &Path) -> Result<Option<Vec<u8>>, String> {
    let path = root.join(LEGACY_PROFILE_MARKER_FILE_NAME);
    if !path.is_file() {
        return Ok(None);
    }
    fs::read(path)
        .map(Some)
        .map_err(|error| format!("无法备份旧账号占用标记：{error}"))
}

fn restore_legacy_library_marker(root: &Path, backup: Option<&[u8]>) -> Result<(), String> {
    let Some(bytes) = backup else {
        return Ok(());
    };
    write_bytes_atomically(&root.join(LEGACY_PROFILE_MARKER_FILE_NAME), bytes)
        .map_err(|error| format!("无法恢复旧账号占用标记：{error}"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    pub id: String,
    /// `None` for an entry with no body on disk — a paper we can list and cite but not
    /// open, which is all a non-open-access record can ever be.
    pub path: Option<String>,
    pub relative_path: Option<String>,
    pub title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryFolder {
    pub name: String,
    pub parent_path: Option<String>,
    pub path: String,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryTrashEntry {
    pub byte_length: u64,
    pub document_count: usize,
    pub name: String,
    pub node_type: String,
    pub original_relative_path: String,
    pub purge_after: u64,
    pub trash_id: String,
    pub trashed_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibrarySnapshot {
    pub entries: Vec<LocalLibraryEntry>,
    pub folders: Vec<LocalLibraryFolder>,
    pub library_id: String,
    pub revision: u64,
    pub root_path: String,
    pub trash_entries: Vec<LocalLibraryTrashEntry>,
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

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryIndex {
    #[serde(default)]
    committed_trash_operations: Vec<String>,
    entries: Vec<LocalLibraryIndexEntry>,
    /// Entries the index owns outright: there is no file to rediscover by scanning, so
    /// losing these would lose the user's record of the paper.
    #[serde(default)]
    metadata_only: Vec<MetadataOnlyEntry>,
    #[serde(default)]
    revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
    /// Size alone cannot detect an in-place rewrite that preserves byte length.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    modified_at_ns: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalTrashManifest {
    #[serde(default)]
    artifact_references: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    document_id: Option<String>,
    #[serde(default)]
    index_entries: Vec<LocalLibraryIndexEntry>,
    #[serde(default)]
    library_id: String,
    #[serde(default)]
    metadata_entries: Vec<MetadataOnlyEntry>,
    original_relative_path: String,
    node_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payload_relative_path: Option<String>,
    purge_after: u64,
    trash_id: String,
    trashed_at: u64,
}

const TRASH_OPERATION_MARKER_FILE_NAME: &str = "operation.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashOperationMarker {
    transaction_id: String,
    operation: String,
    base_revision: u64,
    target_revision: u64,
    #[serde(default)]
    trash_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    restore_target_relative: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payload_relative_path: Option<String>,
    #[serde(default)]
    artifact_names: Vec<String>,
    #[serde(default)]
    restored_document_ids: Vec<String>,
    #[serde(default)]
    restored_metadata_ids: Vec<String>,
    #[serde(default)]
    affected_document_ids: Vec<String>,
    #[serde(default)]
    affected_metadata_ids: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryChangedEvent {
    external_deletion: bool,
    full_rescan: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation_id: Option<String>,
    paths: Vec<String>,
    revision: u64,
    snapshot: LocalLibrarySnapshot,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryWatchErrorEvent {
    code: String,
    message: String,
    trace_id: String,
}

enum LocalLibraryWatchSignal {
    Change {
        external_deletion: bool,
        paths: Vec<PathBuf>,
    },
    Error(String),
}

#[derive(Default)]
struct LocalLibraryWatchBatch {
    external_deletion: bool,
    paths: Vec<PathBuf>,
    watcher_errors: Vec<String>,
}

impl LocalLibraryWatchBatch {
    fn merge(&mut self, signal: LocalLibraryWatchSignal) {
        match signal {
            LocalLibraryWatchSignal::Change {
                external_deletion,
                paths,
            } => {
                self.external_deletion |= external_deletion;
                self.paths.extend(paths);
            }
            LocalLibraryWatchSignal::Error(error) => self.watcher_errors.push(error),
        }
    }

    fn normalized_paths(&self) -> Vec<PathBuf> {
        let mut paths = self.paths.clone();
        paths.sort();
        paths.dedup();
        paths
    }
}

struct LocalOperationEcho {
    expires_at_ms: u128,
    operation_id: String,
    paths: Vec<String>,
}

#[derive(Default)]
pub struct LocalLibraryWatchState {
    operation_echoes: Mutex<Vec<LocalOperationEcho>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn normalized_echo_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn echo_paths_overlap(left: &str, right: &str) -> bool {
    left == right
        || left
            .strip_prefix(right)
            .is_some_and(|suffix| suffix.starts_with('/'))
        || right
            .strip_prefix(left)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn register_local_operation(app: &AppHandle, paths: &[PathBuf]) -> Result<String, String> {
    let now = unix_timestamp_ms();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let operation_id = format!(
        "local_op_{}",
        &hash_text(&format!("{nonce}:{}", paths.len()))[..24]
    );
    let state: State<'_, LocalLibraryWatchState> = app.state();
    let mut echoes = state
        .operation_echoes
        .lock()
        .map_err(|_| "本地文献库操作登记状态不可用。".to_string())?;
    echoes.retain(|entry| entry.expires_at_ms > now);
    echoes.push(LocalOperationEcho {
        expires_at_ms: now + 5_000,
        operation_id: operation_id.clone(),
        paths: paths
            .iter()
            .map(|path| normalized_echo_path(path))
            .collect(),
    });
    Ok(operation_id)
}

fn matching_local_operation_id(
    app: &AppHandle,
    changed_paths: &[PathBuf],
) -> Result<Option<String>, String> {
    let now = unix_timestamp_ms();
    let changed = changed_paths
        .iter()
        .map(|path| normalized_echo_path(path))
        .collect::<Vec<_>>();
    let state: State<'_, LocalLibraryWatchState> = app.state();
    let mut echoes = state
        .operation_echoes
        .lock()
        .map_err(|_| "本地文献库操作登记状态不可用。".to_string())?;
    echoes.retain(|entry| entry.expires_at_ms > now);
    Ok(echoes
        .iter()
        .rev()
        .find(|entry| {
            entry.paths.iter().any(|expected| {
                changed
                    .iter()
                    .any(|observed| echo_paths_overlap(expected, observed))
            })
        })
        .map(|entry| entry.operation_id.clone()))
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

fn modified_at_ns(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_nanos().min(u128::from(u64::MAX)) as u64)
}

fn pdf_path_is_supported(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_PDF_BYTES {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut marker = [0u8; 5];
    file.read_exact(&mut marker).is_ok() && marker == *b"%PDF-"
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamImportManifest {
    created_at: u64,
    name: String,
    target_directory_relative: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryRootSetting {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    root_path: Option<String>,
}

fn root_setting_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("local-library").join(ROOT_SETTING_FILE_NAME))
        .map_err(|error| format!("无法确定当前操作系统用户的应用数据目录：{error}"))
}

fn read_root_override(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path = root_setting_path(app)?;
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

fn write_root_override(app: &AppHandle, root: &Path) -> Result<(), String> {
    let path = root_setting_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    }
    let serialized = serde_json::to_string_pretty(&LibraryRootSetting {
        root_path: Some(root.to_string_lossy().to_string()),
    })
    .map_err(|error| error.to_string())?;
    write_bytes_atomically(&path, serialized.as_bytes())
        .map_err(|error| format!("无法保存文献库根目录设置：{error}"))
}

fn remove_root_override(app: &AppHandle) -> Result<(), String> {
    let path = root_setting_path(app)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|error| format!("无法撤销文献库根目录设置：{error}"))?;
    if let Some(parent) = path.parent() {
        sync_parent_directory(parent)?;
    }
    Ok(())
}

fn legacy_root_candidates(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法确定当前操作系统用户的应用数据目录：{error}"))?;
    let mut candidates = Vec::new();
    let legacy_settings = app_data.join("library-profiles");
    if legacy_settings.is_dir() {
        for profile in fs::read_dir(&legacy_settings)
            .map_err(|error| format!("无法读取旧本地库设置：{error}"))?
        {
            let setting_path = profile
                .map_err(|error| error.to_string())?
                .path()
                .join(ROOT_SETTING_FILE_NAME);
            if !setting_path.is_file() {
                continue;
            }
            let serialized = fs::read_to_string(&setting_path)
                .map_err(|error| format!("无法读取旧本地库根目录：{error}"))?;
            let setting: LibraryRootSetting = serde_json::from_str(&serialized)
                .map_err(|error| format!("旧本地库根目录设置损坏：{error}"))?;
            if let Some(path) = setting.root_path.filter(|value| !value.trim().is_empty()) {
                candidates.push(PathBuf::from(path));
            }
        }
    }

    let legacy_profiles = app_data.join("user-library").join("profiles");
    if legacy_profiles.is_dir() {
        for profile in fs::read_dir(&legacy_profiles)
            .map_err(|error| format!("无法读取旧账号文献库：{error}"))?
        {
            let path = profile.map_err(|error| error.to_string())?.path();
            if path.is_dir() {
                candidates.push(path);
            }
        }
    }

    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let legacy_home = PathBuf::from(home).join("LiteasyLibrary");
        if legacy_home.is_dir() {
            candidates.push(legacy_home);
        }
    }

    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for candidate in candidates {
        let metadata = match fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "无法检查旧本地库目录 {}：{error}",
                    candidate.to_string_lossy()
                ));
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        let normalized = candidate.canonicalize().map_err(|error| {
            format!(
                "无法解析旧本地库目录 {}：{error}",
                candidate.to_string_lossy()
            )
        })?;
        if seen.insert(normalized.clone()) {
            unique.push(normalized);
        }
    }
    Ok(unique)
}

fn default_library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法确定当前操作系统用户的应用数据目录：{error}"))?;
    Ok(app_data.join("local-library").join("library"))
}

fn internal_directory(root: &Path) -> PathBuf {
    root.join(INTERNAL_DIRECTORY_NAME)
}

fn index_path(root: &Path) -> PathBuf {
    internal_directory(root)
        .join(INDEX_DIRECTORY_NAME)
        .join(INDEX_FILE_NAME)
}

fn trash_directory(root: &Path) -> PathBuf {
    internal_directory(root).join(TRASH_DIRECTORY_NAME)
}

fn trash_operation_directory(root: &Path) -> PathBuf {
    internal_directory(root).join(TRASH_OPERATION_DIRECTORY_NAME)
}

fn metadata_entries_directory(root: &Path) -> PathBuf {
    internal_directory(root).join(METADATA_ENTRIES_DIRECTORY_NAME)
}

fn import_staging_directory(root: &Path) -> PathBuf {
    internal_directory(root).join(IMPORT_STAGING_DIRECTORY_NAME)
}

fn purge_expired_import_sessions_at(root: &Path, current_time: u64) -> Result<usize, String> {
    let staging = import_staging_directory(root);
    if !staging.is_dir() {
        return Ok(0);
    }
    let mut removed = 0;
    for entry in
        fs::read_dir(&staging).map_err(|error| format!("无法检查 PDF 导入暂存目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法检查 PDF 导入会话：{error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("无法读取 PDF 导入会话类型：{error}"))?
            .is_dir()
        {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        let created_at = fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|serialized| serde_json::from_str::<StreamImportManifest>(&serialized).ok())
            .map(|manifest| manifest.created_at)
            .or_else(|| {
                fs::metadata(&manifest_path)
                    .or_else(|_| entry.metadata())
                    .ok()?
                    .modified()
                    .ok()?
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .map(|duration| duration.as_secs())
            })
            .unwrap_or(current_time);
        if current_time.saturating_sub(created_at) < IMPORT_STAGING_RETENTION_SECONDS {
            continue;
        }
        fs::remove_dir_all(entry.path())
            .map_err(|error| format!("无法清理过期 PDF 导入会话：{error}"))?;
        removed += 1;
    }
    Ok(removed)
}

pub(crate) fn artifacts_directory(root: &Path) -> PathBuf {
    internal_directory(root).join(ARTIFACTS_DIRECTORY_NAME)
}

fn migrate_legacy_layout(root: &Path) -> Result<(), String> {
    let internal = internal_directory(root);
    fs::create_dir_all(&internal).map_err(|error| format!("无法创建本地库管理目录：{error}"))?;
    let index_directory = internal.join(INDEX_DIRECTORY_NAME);
    fs::create_dir_all(&index_directory)
        .map_err(|error| format!("无法创建本地库索引目录：{error}"))?;

    let next_index = index_path(root);
    let legacy_indexes = [
        internal.join(INDEX_FILE_NAME),
        root.join(LEGACY_INDEX_FILE_NAME),
    ];
    for legacy_index in legacy_indexes {
        if !legacy_index.is_file() || next_index.exists() {
            continue;
        }
        fs::rename(&legacy_index, &next_index)
            .or_else(|_| {
                fs::copy(&legacy_index, &next_index)?;
                fs::remove_file(&legacy_index)
            })
            .map_err(|error| format!("无法迁移本地库索引：{error}"))?;
    }

    let legacy_artifacts = root.join(ARTIFACTS_DIRECTORY_NAME);
    let next_artifacts = artifacts_directory(root);
    if legacy_artifacts.is_dir() && !next_artifacts.exists() {
        if fs::rename(&legacy_artifacts, &next_artifacts).is_err() {
            copy_directory(&legacy_artifacts, &next_artifacts)
                .map_err(|error| format!("无法迁移文献伴生数据：{error}"))?;
            fs::remove_dir_all(&legacy_artifacts)
                .map_err(|error| format!("无法清理旧文献伴生数据：{error}"))?;
        }
    }
    fs::create_dir_all(next_artifacts)
        .map_err(|error| format!("无法创建文献伴生数据目录：{error}"))?;
    fs::create_dir_all(metadata_entries_directory(root))
        .map_err(|error| format!("无法创建仅元数据条目目录：{error}"))?;
    fs::create_dir_all(import_staging_directory(root))
        .map_err(|error| format!("无法创建 PDF 导入暂存目录：{error}"))?;
    fs::create_dir_all(trash_directory(root))
        .map_err(|error| format!("无法创建本地回收站：{error}"))?;
    Ok(())
}

fn prepare_legacy_root_selection(
    root: &Path,
) -> Result<(LocalLibrarySnapshot, Option<Vec<u8>>), String> {
    let legacy_marker = legacy_library_marker_backup(root)?;
    let prepared = (|| {
        migrate_legacy_layout(root)?;
        ensure_library_marker(root)?;
        scan_local_library_root(root)
    })();
    match prepared {
        Ok(snapshot) => Ok((snapshot, legacy_marker)),
        Err(error) => match restore_legacy_library_marker(root, legacy_marker.as_deref()) {
            Ok(()) => Err(format!("旧文献库校验失败，尚未切换当前库：{error}")),
            Err(marker_error) => Err(format!(
                "旧文献库校验失败且旧账号标记恢复失败：{error}；{marker_error}"
            )),
        },
    }
}

pub(crate) fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = match read_root_override(app)? {
        Some(configured) => configured,
        None => {
            let candidates = legacy_root_candidates(app)?;
            match candidates.as_slice() {
                [] => default_library_root(app)?,
                [only] => {
                    let (_, legacy_marker) = prepare_legacy_root_selection(only)?;
                    if let Err(error) = write_root_override(app, only) {
                        return match restore_legacy_library_marker(
                            only,
                            legacy_marker.as_deref(),
                        ) {
                            Ok(()) => Err(format!(
                                "无法保存自动选择的旧文献库位置，尚未切换当前库：{error}"
                            )),
                            Err(marker_error) => Err(format!(
                                "无法保存自动选择的旧文献库位置且旧账号标记恢复失败：{error}；{marker_error}"
                            )),
                        };
                    }
                    only.clone()
                }
                _ => {
                    let paths = candidates
                        .iter()
                        .map(|path| path.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("；");
                    return Err(format!(
                        "检测到多个旧账号本地库，请先选择一个当前库，未选择的目录不会被改动：{paths}"
                    ));
                }
            }
        }
    };
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let canonical = root.canonicalize().map_err(|error| error.to_string())?;
    migrate_legacy_layout(&canonical)?;
    ensure_library_marker(&canonical)?;
    Ok(canonical)
}

fn copy_directory(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| format!("无法创建目标目录：{error}"))?;
    for entry in fs::read_dir(from).map_err(|error| format!("无法读取源目录：{error}"))? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = to.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err(format!(
                "文献库包含不允许迁移的符号链接或目录联接：{}",
                entry.path().to_string_lossy()
            ));
        }
        if file_type.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map(|_| ())
                .map_err(|error| format!("复制文件失败：{error}"))?;
            fs::OpenOptions::new()
                .write(true)
                .open(&target)
                .and_then(|file| file.sync_all())
                .map_err(|error| format!("无法落盘迁移后的文件：{error}"))?;
        } else {
            return Err(format!(
                "文献库包含不支持的设备或特殊文件：{}",
                entry.path().to_string_lossy()
            ));
        }
    }
    sync_parent_directory(to)?;
    Ok(())
}

fn sync_parent_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let directory = if path.is_dir() {
            path
        } else {
            path.parent()
                .ok_or_else(|| "目标文件缺少父目录。".to_string())?
        };
        fs::File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("无法落盘目录变更：{error}"))?;
    }
    Ok(())
}

fn collect_tree_manifest(
    root: &Path,
    directory: &Path,
    rows: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| format!("无法读取文献库：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let relative = relative_path(root, &entry.path())?;
        if file_type.is_symlink() {
            return Err(format!("文献库包含不允许的符号链接或目录联接：{relative}"));
        }
        if file_type.is_dir() {
            rows.push(format!("D:{relative}"));
            collect_tree_manifest(root, &entry.path(), rows)?;
        } else if file_type.is_file() {
            let size = entry.metadata().map_err(|error| error.to_string())?.len();
            rows.push(format!(
                "F:{relative}:{size}:{}",
                hash_file_contents(&entry.path())?
            ));
        } else {
            return Err(format!("文献库包含不支持的设备或特殊文件：{relative}"));
        }
    }
    Ok(())
}

fn verified_tree_manifest(root: &Path) -> Result<Vec<String>, String> {
    let mut rows = Vec::new();
    collect_tree_manifest(root, root, &mut rows)?;
    rows.sort();
    Ok(rows)
}

fn clear_directory(directory: &Path) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() && !file_type.is_symlink() {
            fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    sync_parent_directory(directory)
}

fn prepare_library_migration(current: &Path, target: &Path) -> Result<(), String> {
    let source_manifest = verified_tree_manifest(current)?;
    if let Err(error) = copy_directory(current, target) {
        let _ = clear_directory(target);
        return Err(format!("迁移文献库复制失败，旧库保持不变：{error}"));
    }
    let target_manifest = match verified_tree_manifest(target) {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = clear_directory(target);
            return Err(format!("无法校验迁移后的文献库，旧库保持不变：{error}"));
        }
    };
    if source_manifest != target_manifest {
        let _ = clear_directory(target);
        return Err("迁移后的文献库校验不一致，旧库保持不变。".to_string());
    }
    Ok(())
}

fn export_library_backup_at_root(
    current: &Path,
    destination_parent: &Path,
) -> Result<PathBuf, String> {
    if destination_parent == current || destination_parent.starts_with(current) {
        return Err("备份保存目录不能位于当前文献库内部。".to_string());
    }
    let timestamp = unix_timestamp();
    let mut target = None;
    for attempt in 0..10 {
        let suffix = &hash_text(&format!(
            "{}:{}:{}",
            current.display(),
            unix_timestamp_ms(),
            attempt
        ))[..8];
        let candidate = destination_parent.join(format!("Liteasy-Backup-{timestamp}-{suffix}"));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                target = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建文献库备份目录：{error}")),
        }
    }
    let target = target.ok_or_else(|| "无法生成唯一的文献库备份目录，请重试。".to_string())?;
    if let Err(error) = prepare_library_migration(current, &target) {
        let _ = fs::remove_dir_all(&target);
        return Err(format!("文献库备份失败，当前库保持不变：{error}"));
    }
    Ok(target)
}

#[tauri::command]
pub fn backup_local_library(
    app: AppHandle,
    destination_directory: String,
) -> Result<String, String> {
    let requested = PathBuf::from(destination_directory.trim());
    if requested.as_os_str().is_empty() || !requested.is_absolute() {
        return Err("请提供备份保存目录的完整路径。".to_string());
    }
    let destination_parent = requested
        .canonicalize()
        .map_err(|error| format!("无法访问备份保存目录：{error}"))?;
    if !destination_parent.is_dir() {
        return Err("备份保存位置必须是已存在的目录。".to_string());
    }
    let current = library_root(&app)?;
    let target = export_library_backup_at_root(&current, &destination_parent)?;
    Ok(target.to_string_lossy().to_string())
}

/// Moves the library to a new root. Everything the library owns goes together — leaving
/// any of it behind would split the library in two, with annotations pointing at papers
/// that are no longer listed.
#[tauri::command]
pub fn select_legacy_local_library_root(
    app: AppHandle,
    legacy_root_path: String,
) -> Result<LocalLibrarySnapshot, String> {
    if read_root_override(&app)?.is_some() {
        return Err("旧文献库选择已经完成；如需更换位置，请使用移动文献库。".to_string());
    }
    let requested = PathBuf::from(legacy_root_path.trim());
    if requested.as_os_str().is_empty() || !requested.is_absolute() {
        return Err("请选择检测到的旧文献库完整路径。".to_string());
    }
    let metadata = fs::symlink_metadata(&requested)
        .map_err(|error| format!("无法访问所选旧文献库：{error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("所选旧文献库必须是现有的普通目录，不能是符号链接或目录联接。".to_string());
    }
    let target = requested
        .canonicalize()
        .map_err(|error| format!("无法解析所选旧文献库：{error}"))?;
    let candidates = legacy_root_candidates(&app)?;
    if !candidates.iter().any(|candidate| candidate == &target) {
        return Err("所选目录不在检测到的旧文献库列表中，请重新检查。".to_string());
    }

    let (snapshot, legacy_marker) = prepare_legacy_root_selection(&target)?;
    if let Err(error) = write_root_override(&app, &target) {
        return match restore_legacy_library_marker(&target, legacy_marker.as_deref()) {
            Ok(()) => Err(format!("无法保存所选旧文献库位置，尚未切换当前库：{error}")),
            Err(marker_error) => Err(format!(
                "无法保存所选旧文献库位置且旧账号标记恢复失败：{error}；{marker_error}"
            )),
        };
    }
    if let Err(watcher_error) = restart_local_library_watcher(&app) {
        let pointer_result = remove_root_override(&app);
        let marker_result = restore_legacy_library_marker(&target, legacy_marker.as_deref());
        return match (pointer_result, marker_result) {
            (Ok(()), Ok(())) => Err(format!(
                "无法监听所选旧文献库，当前库选择已撤销：{watcher_error}"
            )),
            (pointer, marker) => Err(format!(
                "无法监听所选旧文献库，且选择回滚未完整完成：{watcher_error}；指针回滚：{}；旧标记恢复：{}",
                pointer.err().unwrap_or_else(|| "成功".to_string()),
                marker.err().unwrap_or_else(|| "成功".to_string())
            )),
        };
    }
    Ok(snapshot)
}

/// Moves the active library into a new empty directory after the one-time legacy choice.
#[tauri::command]
pub fn set_local_library_root(
    app: AppHandle,
    next_root_path: String,
) -> Result<LocalLibrarySnapshot, String> {
    let requested = PathBuf::from(next_root_path.trim());
    if requested.as_os_str().is_empty() || !requested.is_absolute() {
        return Err("请提供文献库根目录的完整路径。".to_string());
    }
    fs::create_dir_all(&requested).map_err(|error| format!("无法创建目标文献库目录：{error}"))?;
    let target = requested
        .canonicalize()
        .map_err(|error| format!("无法访问目标文献库目录：{error}"))?;

    let current = library_root(&app)?;
    if target == current {
        return load_local_library_snapshot(app);
    }
    if target.starts_with(&current) {
        return Err("新的文献库根目录不能位于当前文献库内部。".to_string());
    }
    if current.starts_with(&target) {
        return Err("新的文献库根目录不能是当前文献库的上层目录。".to_string());
    }

    let target_entries = fs::read_dir(&target)
        .map_err(|error| format!("无法读取目标文献库目录：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !target_entries.is_empty() {
        return Err("目标目录必须为空，避免迁移时覆盖已有文件。".to_string());
    }

    prepare_library_migration(&current, &target)?;

    if let Err(error) = write_root_override(&app, &target) {
        let _ = clear_directory(&target);
        return Err(format!("无法保存新的文献库位置，旧库保持不变：{error}"));
    }
    if let Err(watcher_error) = restart_local_library_watcher(&app) {
        if let Err(pointer_error) = write_root_override(&app, &current) {
            return Err(format!(
                "新库已完整复制，但监听启动失败，且根目录指针无法回滚；目标库保持完整以便修复：{watcher_error}；指针错误：{pointer_error}"
            ));
        }
        let _ = restart_local_library_watcher(&app);
        let cleanup_result = clear_directory(&target);
        return Err(match cleanup_result {
            Ok(()) => format!("无法监听新文献库，根目录已回滚到旧库：{watcher_error}"),
            Err(cleanup_error) => format!(
                "无法监听新文献库，根目录已回滚到旧库，但目标副本清理失败：{watcher_error}；清理错误：{cleanup_error}"
            ),
        });
    }
    clear_directory(&current)
        .map_err(|error| format!("新文献库已启用，但旧位置清理失败：{error}"))?;
    load_local_library_snapshot(app)
}

#[tauri::command]
pub fn open_local_library_in_file_manager(app: AppHandle) -> Result<(), String> {
    let root = library_root(&app)?;
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
pub(crate) fn library_papers_directory(app: &AppHandle) -> Result<PathBuf, String> {
    library_root(app)
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "资源不在本地文献库中。".to_string())
}

fn read_index(root: &Path) -> Result<LocalLibraryIndex, String> {
    let path = index_path(root);
    if !path.exists() {
        let mut index = LocalLibraryIndex::default();
        index.metadata_only = read_metadata_entries(root)?;
        return Ok(index);
    }
    let serialized = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut index: LocalLibraryIndex = serde_json::from_str(&serialized)
        .map_err(|error| format!("本地文献库索引损坏，已停止修改以保护现有数据：{error}"))?;
    index.metadata_only = migrate_index_metadata_entries(root, &index.metadata_only)?;
    Ok(index)
}

fn write_index(root: &Path, index: &LocalLibraryIndex) -> Result<(), String> {
    let path = index_path(root);
    let serialized = serde_json::to_string_pretty(index).map_err(|error| error.to_string())?;
    write_bytes_atomically(&path, serialized.as_bytes())
}

fn metadata_entry_path(root: &Path, document_id: &str) -> Result<PathBuf, String> {
    if document_id.is_empty()
        || document_id.len() > 128
        || !document_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("仅元数据条目标识无效。".to_string());
    }
    Ok(metadata_entries_directory(root).join(format!("{document_id}.json")))
}

fn write_metadata_entry(root: &Path, entry: &MetadataOnlyEntry) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(entry).map_err(|error| error.to_string())?;
    write_bytes_atomically(&metadata_entry_path(root, &entry.id)?, &serialized)
        .map_err(|error| format!("无法保存仅元数据条目：{error}"))
}

fn read_metadata_entries(root: &Path) -> Result<Vec<MetadataOnlyEntry>, String> {
    let directory = metadata_entries_directory(root);
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建仅元数据条目目录：{error}"))?;
    let mut entries = Vec::new();
    let mut ids = HashSet::new();
    for item in
        fs::read_dir(&directory).map_err(|error| format!("无法读取仅元数据条目目录：{error}"))?
    {
        let item = item.map_err(|error| error.to_string())?;
        let file_type = item.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() || !file_type.is_file() {
            return Err("仅元数据条目目录包含不支持的资源，已停止修改以保护数据。".to_string());
        }
        if item.path().extension().and_then(|value| value.to_str()) != Some("json") {
            return Err("仅元数据条目目录包含未知文件，已停止修改以保护数据。".to_string());
        }
        let serialized = fs::read_to_string(item.path())
            .map_err(|error| format!("无法读取仅元数据条目：{error}"))?;
        let entry: MetadataOnlyEntry = serde_json::from_str(&serialized)
            .map_err(|error| format!("仅元数据条目损坏，已停止修改以保护数据：{error}"))?;
        if metadata_entry_path(root, &entry.id)? != item.path() || !ids.insert(entry.id.clone()) {
            return Err("仅元数据条目标识与文件名不一致或重复，已停止修改以保护数据。".to_string());
        }
        entries.push(entry);
    }
    entries.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(entries)
}

fn migrate_index_metadata_entries(
    root: &Path,
    indexed: &[MetadataOnlyEntry],
) -> Result<Vec<MetadataOnlyEntry>, String> {
    for entry in indexed {
        let path = metadata_entry_path(root, &entry.id)?;
        if !path.exists() {
            write_metadata_entry(root, entry)?;
        }
    }
    read_metadata_entries(root)
}

fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标文件缺少父目录。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建目标目录：{error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = parent.join(format!(".liteasy.{}.{nonce}.tmp", std::process::id()));
    let mut temporary = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)
        .map_err(|error| format!("无法创建临时文件：{error}"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.sync_all())
        .map_err(|error| format!("无法写入临时文件：{error}"))?;

    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("无法替换旧文件：{error}"))?;
    }
    let result =
        fs::rename(&temporary_path, path).map_err(|error| format!("无法发布文件：{error}"));
    if result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(temporary_path);
    }
    result?;
    sync_parent_directory(path)
}

fn collect_library_paths(
    root: &Path,
    directory: &Path,
    folders: &mut Vec<LocalLibraryFolder>,
    paths: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if entry.file_name() == INTERNAL_DIRECTORY_NAME
                || entry.file_name() == ARTIFACTS_DIRECTORY_NAME
            {
                continue;
            }
            let path = entry.path();
            folders.push(LocalLibraryFolder {
                name: entry.file_name().to_string_lossy().to_string(),
                parent_path: path
                    .parent()
                    .filter(|parent| *parent != root)
                    .map(|parent| parent.to_string_lossy().to_string()),
                path: path.to_string_lossy().to_string(),
            });
            collect_library_paths(root, &path, folders, paths)?;
        } else if file_type.is_file()
            && entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
            && pdf_path_is_supported(&entry.path())
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

fn read_trash_manifest(path: &Path) -> Result<LocalTrashManifest, String> {
    let serialized =
        fs::read_to_string(path).map_err(|error| format!("无法读取本地回收站清单：{error}"))?;
    serde_json::from_str(&serialized).map_err(|error| format!("本地回收站清单损坏：{error}"))
}

fn list_trash_entries(root: &Path) -> Result<Vec<LocalLibraryTrashEntry>, String> {
    let trash = trash_directory(root);
    let mut entries = Vec::new();
    for directory in fs::read_dir(&trash).map_err(|error| format!("无法读取本地回收站：{error}"))?
    {
        let directory = directory.map_err(|error| error.to_string())?;
        if !directory
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let manifest = read_trash_manifest(&directory.path().join("manifest.json"))?;
        let name = Path::new(&manifest.original_relative_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("未命名资源")
            .to_string();
        entries.push(LocalLibraryTrashEntry {
            byte_length: directory_size(&directory.path())?,
            document_count: manifest.index_entries.len() + manifest.metadata_entries.len(),
            name,
            node_type: manifest.node_type,
            original_relative_path: manifest.original_relative_path,
            purge_after: manifest.purge_after,
            trash_id: manifest.trash_id,
            trashed_at: manifest.trashed_at,
        });
    }
    entries.sort_by(|left, right| right.trashed_at.cmp(&left.trashed_at));
    Ok(entries)
}

fn directory_size(directory: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            total = total.saturating_add(directory_size(&entry.path())?);
        } else if file_type.is_file() {
            total =
                total.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
        }
    }
    Ok(total)
}

#[tauri::command]
pub fn load_local_library_snapshot(app: AppHandle) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app)?;
    scan_local_library_root(&root)
}

fn scan_local_library_root(root: &Path) -> Result<LocalLibrarySnapshot, String> {
    recover_trash_operations(root)?;
    purge_expired_trash(&root)?;
    purge_expired_import_sessions_at(root, unix_timestamp())?;
    let mut pdf_paths = Vec::new();
    let mut folders = Vec::new();
    collect_library_paths(&root, &root, &mut folders, &mut pdf_paths)?;
    pdf_paths.sort();
    folders.sort_by(|left, right| left.path.cmp(&right.path));

    let existing_index = read_index(&root)?;
    let previous_entries = existing_index.entries.clone();
    let previous_metadata = existing_index.metadata_only.clone();
    let previous_revision = existing_index.revision;
    let committed_trash_operations = existing_index.committed_trash_operations.clone();
    // Scanning only rediscovers files, so these have to be carried across the rewrite.
    let metadata_only = existing_index.metadata_only;
    let indexed_entries = existing_index.entries;
    let stored_by_path: HashMap<String, LocalLibraryIndexEntry> = indexed_entries
        .iter()
        .cloned()
        .into_iter()
        .map(|entry| (entry.relative_path.clone(), entry))
        .collect();
    let scanned_paths = pdf_paths
        .into_iter()
        .map(|path| relative_path(&root, &path).map(|relative| (path, relative)))
        .collect::<Result<Vec<_>, _>>()?;
    let current_relative_paths = scanned_paths
        .iter()
        .map(|(_, relative)| relative.clone())
        .collect::<HashSet<_>>();
    let mut missing_by_hash: HashMap<String, Vec<LocalLibraryIndexEntry>> = HashMap::new();
    for entry in indexed_entries {
        if !current_relative_paths.contains(&entry.relative_path) {
            if let Some(content_hash) = &entry.content_hash {
                missing_by_hash
                    .entry(content_hash.clone())
                    .or_default()
                    .push(entry);
            }
        }
    }
    for candidates in missing_by_hash.values_mut() {
        candidates.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    }
    let mut used_ids = HashSet::new();
    let mut next_index = LocalLibraryIndex::default();
    let mut entries = Vec::new();

    for (sequence, (path, relative)) in scanned_paths.into_iter().enumerate() {
        let metadata =
            fs::metadata(&path).map_err(|error| format!("无法读取 PDF 文件信息：{error}"))?;
        let file_size = Some(metadata.len());
        let file_modified_at_ns = modified_at_ns(&metadata);
        let stored = stored_by_path.get(&relative);
        // Full validation must detect same-size rewrites even on file systems with coarse
        // timestamp precision. Incremental watcher optimizations may narrow the path set,
        // but a validated path is always fingerprinted from its current bytes.
        let content_hash = Some(hash_file_contents(&path)?);

        // An id already handed out never changes: annotations and anchor indexes are
        // keyed by it, so re-deriving it would orphan the user's work.
        let renamed_entry = stored
            .is_none()
            .then(|| {
                content_hash.as_ref().and_then(|hash| {
                    missing_by_hash.get_mut(hash).and_then(|candidates| {
                        candidates
                            .iter()
                            .position(|candidate| !used_ids.contains(&candidate.id))
                            .map(|position| candidates.remove(position))
                    })
                })
            })
            .flatten();
        let base_id = match stored.or(renamed_entry.as_ref()) {
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
            content_hash: content_hash.clone(),
            file_size,
            id: id.clone(),
            modified_at_ns: file_modified_at_ns,
            relative_path: relative.clone(),
        });
        entries.push(LocalLibraryEntry {
            content_hash,
            id,
            path: Some(path.to_string_lossy().to_string()),
            relative_path: Some(relative),
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
            content_hash: None,
            id: entry.id.clone(),
            path: None,
            relative_path: None,
            title: entry.title.clone(),
        });
    }
    next_index.metadata_only = metadata_only;
    next_index.committed_trash_operations = committed_trash_operations;
    next_index.revision = if next_index.entries != previous_entries
        || next_index.metadata_only != previous_metadata
    {
        previous_revision.saturating_add(1).max(1)
    } else {
        previous_revision.max(1)
    };

    write_index(&root, &next_index)?;
    let marker = ensure_library_marker(&root)?;
    Ok(LocalLibrarySnapshot {
        entries,
        folders,
        library_id: marker.library_id,
        revision: next_index.revision,
        root_path: root.to_string_lossy().to_string(),
        trash_entries: list_trash_entries(&root)?,
    })
}

fn snapshot_from_index(
    root: &Path,
    index: &LocalLibraryIndex,
) -> Result<LocalLibrarySnapshot, String> {
    let mut folders = Vec::new();
    let mut ignored_pdf_paths = Vec::new();
    collect_library_paths(root, root, &mut folders, &mut ignored_pdf_paths)?;
    folders.sort_by(|left, right| left.path.cmp(&right.path));

    let mut entries = Vec::new();
    for entry in &index.entries {
        let path = root.join(manifest_relative_path(&entry.relative_path)?);
        if !pdf_path_is_supported(&path) {
            return Err("增量索引与磁盘状态不一致，需要完整校验。".to_string());
        }
        entries.push(LocalLibraryEntry {
            content_hash: entry.content_hash.clone(),
            id: entry.id.clone(),
            path: Some(path.to_string_lossy().to_string()),
            relative_path: Some(entry.relative_path.clone()),
            title: path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled PDF")
                .to_string(),
        });
    }
    let mut used_ids = index
        .entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<HashSet<_>>();
    for entry in &index.metadata_only {
        if used_ids.insert(entry.id.clone()) {
            entries.push(LocalLibraryEntry {
                content_hash: None,
                id: entry.id.clone(),
                path: None,
                relative_path: None,
                title: entry.title.clone(),
            });
        }
    }
    entries.sort_by(|left, right| left.title.cmp(&right.title).then(left.id.cmp(&right.id)));
    let marker = ensure_library_marker(root)?;
    Ok(LocalLibrarySnapshot {
        entries,
        folders,
        library_id: marker.library_id,
        revision: index.revision,
        root_path: root.to_string_lossy().to_string(),
        trash_entries: list_trash_entries(root)?,
    })
}

fn relative_path_is_within(candidate: &str, prefix: &str) -> bool {
    candidate == prefix
        || candidate
            .strip_prefix(prefix)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn scan_local_library_paths(
    root: &Path,
    affected_paths: &[PathBuf],
) -> Result<LocalLibrarySnapshot, String> {
    recover_trash_operations(root)?;
    purge_expired_trash(root)?;
    if affected_paths.is_empty() {
        return Err("监听事件没有可校验路径，需要完整校验。".to_string());
    }

    let mut affected_relative = Vec::new();
    for path in affected_paths {
        let relative = relative_path(root, path)?;
        if relative.is_empty()
            || Path::new(&relative)
                .components()
                .any(|component| component.as_os_str() == INTERNAL_DIRECTORY_NAME)
        {
            return Err("监听事件涉及库根目录或内部目录，需要完整校验。".to_string());
        }
        affected_relative.push(relative);
    }
    affected_relative.sort();
    affected_relative.dedup();

    let mut index = read_index(root)?;
    let previous_entries = index.entries.clone();
    let stored_by_path = previous_entries
        .iter()
        .cloned()
        .map(|entry| (entry.relative_path.clone(), entry))
        .collect::<HashMap<_, _>>();
    let mut removed = previous_entries
        .iter()
        .filter(|entry| {
            affected_relative
                .iter()
                .any(|prefix| relative_path_is_within(&entry.relative_path, prefix))
        })
        .cloned()
        .collect::<Vec<_>>();
    index.entries.retain(|entry| {
        !affected_relative
            .iter()
            .any(|prefix| relative_path_is_within(&entry.relative_path, prefix))
    });

    let mut discovered = Vec::new();
    for relative in &affected_relative {
        let path = root.join(manifest_relative_path(relative)?);
        let Ok(file_type) = fs::symlink_metadata(&path).map(|metadata| metadata.file_type()) else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let mut ignored_folders = Vec::new();
            collect_library_paths(root, &path, &mut ignored_folders, &mut discovered)?;
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
            && pdf_path_is_supported(&path)
        {
            discovered.push(path);
        }
    }
    discovered.sort();
    discovered.dedup();
    removed.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    let mut used_ids = index
        .entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<HashSet<_>>();
    for (sequence, path) in discovered.into_iter().enumerate() {
        let relative = relative_path(root, &path)?;
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        let content_hash = hash_file_contents(&path)?;
        let stored = stored_by_path.get(&relative);
        let renamed = stored
            .is_none()
            .then(|| {
                removed
                    .iter()
                    .position(|entry| entry.content_hash.as_deref() == Some(content_hash.as_str()))
                    .map(|position| removed.remove(position))
            })
            .flatten();
        let base_id = stored
            .or(renamed.as_ref())
            .map(|entry| entry.id.clone())
            .unwrap_or_else(|| next_entry_id(sequence));
        let mut id = base_id.clone();
        let mut duplicate = 2usize;
        while used_ids.contains(&id) {
            id = format!("{base_id}-{duplicate}");
            duplicate += 1;
        }
        used_ids.insert(id.clone());
        index.entries.push(LocalLibraryIndexEntry {
            id,
            relative_path: relative,
            content_hash: Some(content_hash),
            file_size: Some(metadata.len()),
            modified_at_ns: modified_at_ns(&metadata),
        });
    }
    index
        .entries
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    index.revision = index.revision.saturating_add(1).max(1);
    write_index(root, &index)?;
    snapshot_from_index(root, &index)
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
) -> Result<LocalLibrarySnapshot, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("条目标题不能为空。".to_string());
    }
    let doi = non_empty(doi);
    let external_url = non_empty(external_url);
    let root = library_root(&app)?;
    let mut index = read_index(&root)?;
    let id = metadata_only_entry_id(doi.as_deref(), external_url.as_deref(), &title);
    if !index.metadata_only.iter().any(|entry| entry.id == id) {
        let entry = MetadataOnlyEntry {
            doi,
            external_url,
            id,
            source_id: non_empty(source_id),
            title,
        };
        write_metadata_entry(&root, &entry)?;
        index.metadata_only.push(entry.clone());
        index.revision = index.revision.saturating_add(1).max(1);
        if let Err(error) = write_index(&root, &index) {
            let _ = fs::remove_file(metadata_entry_path(&root, &entry.id)?);
            return Err(error);
        }
    }
    load_local_library_snapshot(app)
}

fn resolve_import_directory(
    root: &Path,
    requested_path: Option<String>,
) -> Result<PathBuf, String> {
    let directory = match requested_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => root.to_path_buf(),
    };
    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("无法访问导入目录：{error}"))?;
    if !canonical.is_dir()
        || !canonical.starts_with(root)
        || canonical.starts_with(internal_directory(root))
    {
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
        let candidate = directory.join(&name);
        if !directory_contains_name(directory, &name, cfg!(windows))? {
            return Ok(candidate);
        }
        sequence += 1;
    }
}

fn directory_contains_name(
    directory: &Path,
    requested_name: &str,
    case_insensitive: bool,
) -> Result<bool, String> {
    for entry in fs::read_dir(directory).map_err(|error| format!("无法读取目标目录：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let existing_name = entry.file_name().to_string_lossy().to_string();
        if existing_name == requested_name
            || (case_insensitive && existing_name.eq_ignore_ascii_case(requested_name))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn resolve_import_session(root: &Path, import_id: &str) -> Result<PathBuf, String> {
    if import_id.is_empty()
        || import_id.len() > 128
        || !import_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("PDF 导入会话标识无效。".to_string());
    }
    let session = import_staging_directory(root).join(import_id);
    if !session.is_dir() {
        return Err("PDF 导入会话不存在或已结束。".to_string());
    }
    Ok(session)
}

#[tauri::command]
pub fn begin_local_library_pdf_import(
    app: AppHandle,
    import_id: String,
    name: String,
    target_folder_path: Option<String>,
) -> Result<(), String> {
    let root = library_root(&app)?;
    purge_expired_import_sessions_at(&root, unix_timestamp())?;
    let directory = resolve_import_directory(&root, target_folder_path)?;
    unique_pdf_target(&directory, &name)?;
    if import_id.is_empty()
        || import_id.len() > 128
        || !import_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("PDF 导入会话标识无效。".to_string());
    }
    let session = import_staging_directory(&root).join(&import_id);
    fs::create_dir(&session).map_err(|error| format!("无法创建 PDF 导入会话：{error}"))?;
    let manifest = StreamImportManifest {
        created_at: unix_timestamp(),
        name,
        target_directory_relative: relative_path(&root, &directory)?,
    };
    let serialized = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    if let Err(error) = write_bytes_atomically(&session.join("manifest.json"), &serialized)
        .and_then(|_| {
            fs::File::create(session.join("payload.part"))
                .and_then(|file| file.sync_all())
                .map_err(|error| format!("无法创建 PDF 暂存文件：{error}"))
        })
    {
        let _ = fs::remove_dir_all(session);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn append_local_library_pdf_import(
    app: AppHandle,
    import_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let root = library_root(&app)?;
    append_pdf_import_chunk(&root, &import_id, &bytes)
}

fn append_pdf_import_chunk(root: &Path, import_id: &str, bytes: &[u8]) -> Result<(), String> {
    const MAX_CHUNK_BYTES: usize = 1024 * 1024;
    if bytes.is_empty() || bytes.len() > MAX_CHUNK_BYTES {
        return Err("PDF 导入块必须介于 1 字节和 1 MB 之间。".to_string());
    }
    let session = resolve_import_session(root, import_id)?;
    let payload = session.join("payload.part");
    let current_size = fs::metadata(&payload)
        .map_err(|error| format!("无法读取 PDF 暂存状态：{error}"))?
        .len();
    if current_size.saturating_add(bytes.len() as u64) > MAX_PDF_BYTES {
        return Err("导入的 PDF 超过 256 MB。".to_string());
    }
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(payload)
        .map_err(|error| format!("无法打开 PDF 暂存文件：{error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("无法写入 PDF 暂存块：{error}"))
}

#[tauri::command]
pub fn finish_local_library_pdf_import(
    app: AppHandle,
    import_id: String,
    duplicate_action: Option<String>,
) -> Result<LocalLibraryImportResult, String> {
    let root = library_root(&app)?;
    let session = resolve_import_session(&root, &import_id)?;
    let manifest: StreamImportManifest = serde_json::from_str(
        &fs::read_to_string(session.join("manifest.json"))
            .map_err(|error| format!("无法读取 PDF 导入清单：{error}"))?,
    )
    .map_err(|error| format!("PDF 导入清单损坏：{error}"))?;
    let payload = session.join("payload.part");
    if !pdf_path_is_supported(&payload) {
        return Err(format!("导入文件不是有效的受支持 PDF：{}", manifest.name));
    }
    fs::OpenOptions::new()
        .write(true)
        .open(&payload)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("无法落盘 PDF 暂存文件：{error}"))?;
    let content_hash = hash_file_contents(&payload)?;
    let index = read_index(&root)?;
    let existing_document_ids = index
        .entries
        .iter()
        .filter(|entry| entry.content_hash.as_deref() == Some(&content_hash))
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    let duplicates = (!existing_document_ids.is_empty())
        .then(|| DuplicateLocalPdf {
            content_hash,
            existing_document_ids,
            name: manifest.name.clone(),
        })
        .into_iter()
        .collect::<Vec<_>>();
    let action = duplicate_action.as_deref().unwrap_or("");
    if !duplicates.is_empty() && action != "save_copy" {
        if !action.is_empty() && action != "cancel" {
            return Err("Duplicate action must be save_copy or cancel.".to_string());
        }
        if action == "cancel" {
            fs::remove_dir_all(&session).map_err(|error| format!("无法取消 PDF 导入：{error}"))?;
        }
        return Ok(LocalLibraryImportResult {
            duplicates,
            snapshot: load_local_library_snapshot(app)?,
            status: if action == "cancel" {
                "cancelled"
            } else {
                "duplicate"
            }
            .to_string(),
        });
    }
    let directory = if manifest.target_directory_relative.is_empty() {
        root.clone()
    } else {
        root.join(manifest_relative_path(&manifest.target_directory_relative)?)
            .canonicalize()
            .map_err(|error| format!("PDF 导入目标目录不再可用：{error}"))?
    };
    if !directory.starts_with(&root) || directory.starts_with(internal_directory(&root)) {
        return Err("PDF 导入目标目录已越过本地文献库边界。".to_string());
    }
    let target = unique_pdf_target(&directory, &manifest.name)?;
    fs::rename(&payload, &target).map_err(|error| format!("无法发布导入的 PDF：{error}"))?;
    if let Err(error) = sync_parent_directory(&target) {
        let rollback = fs::rename(&target, &payload);
        return Err(match rollback {
            Ok(()) => format!("PDF 发布未能落盘，已回滚：{error}"),
            Err(rollback_error) => {
                format!("PDF 发布未能落盘且无法自动回滚：{error}；回滚错误：{rollback_error}")
            }
        });
    }
    let _ = fs::remove_dir_all(&session);
    let _ = register_local_operation(&app, std::slice::from_ref(&target));
    Ok(LocalLibraryImportResult {
        duplicates,
        snapshot: load_local_library_snapshot(app)?,
        status: "imported".to_string(),
    })
}

#[tauri::command]
pub fn cancel_local_library_pdf_import(app: AppHandle, import_id: String) -> Result<(), String> {
    let root = library_root(&app)?;
    let session = resolve_import_session(&root, &import_id)?;
    fs::remove_dir_all(session).map_err(|error| format!("无法取消 PDF 导入：{error}"))
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
    if fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("不允许操作符号链接或目录联接。".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("找不到源资源：{error}"))?;
    if canonical == root
        || !canonical.starts_with(root)
        || canonical.starts_with(internal_directory(root))
    {
        return Err("只能修改本地文献库根目录内的资源。".to_string());
    }
    Ok(canonical)
}

#[tauri::command]
pub fn read_local_library_pdf(app: AppHandle, source_path: String) -> Result<Vec<u8>, String> {
    let root = library_root(&app)?;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryPdfInfo {
    byte_length: u64,
}

fn resolve_readable_library_pdf(root: &Path, source_path: &str) -> Result<(PathBuf, u64), String> {
    let source = resolve_existing_resource(root, source_path)?;
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
    Ok((source, size))
}

#[tauri::command]
pub fn local_library_pdf_info(
    app: AppHandle,
    source_path: String,
) -> Result<LocalLibraryPdfInfo, String> {
    let root = library_root(&app)?;
    let (_, byte_length) = resolve_readable_library_pdf(&root, &source_path)?;
    Ok(LocalLibraryPdfInfo { byte_length })
}

#[tauri::command]
pub fn read_local_library_pdf_chunk(
    app: AppHandle,
    source_path: String,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    if length == 0 || length > PDF_READ_CHUNK_BYTES {
        return Err("PDF 读取分块大小无效。".to_string());
    }
    let root = library_root(&app)?;
    let (source, byte_length) = resolve_readable_library_pdf(&root, &source_path)?;
    if offset >= byte_length {
        return Ok(Vec::new());
    }
    let read_length = length.min((byte_length - offset) as usize);
    let mut file = fs::File::open(source).map_err(|error| format!("读取 PDF 失败：{error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("定位 PDF 读取位置失败：{error}"))?;
    let mut bytes = vec![0u8; read_length];
    file.read_exact(&mut bytes)
        .map_err(|error| format!("读取 PDF 分块失败：{error}"))?;
    Ok(bytes)
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
    if !parent.starts_with(root) || parent.starts_with(internal_directory(root)) {
        return Err("目标目录必须位于本地文献库中。".to_string());
    }
    let target = parent.join(file_name);
    if directory_contains_name(&parent, &file_name.to_string_lossy(), cfg!(windows))? {
        return Err("目标位置已经存在同名资源。".to_string());
    }
    Ok(target)
}

#[tauri::command]
pub fn move_local_library_resource(
    app: AppHandle,
    source_path: String,
    target_path: String,
) -> Result<(), String> {
    let root = library_root(&app)?;
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
        index.revision = index.revision.saturating_add(1).max(1);
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
    let _ = register_local_operation(&app, &[source, target]);
    Ok(())
}

fn validate_folder_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name == INTERNAL_DIRECTORY_NAME
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err("文件夹名称无效。".to_string());
    }
    if name.len() > 255 {
        return Err("文件夹名称过长。".to_string());
    }
    Ok(name.to_string())
}

#[tauri::command]
pub fn create_local_library_folder(
    app: AppHandle,
    name: String,
    parent_path: Option<String>,
) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app)?;
    let name = validate_folder_name(&name)?;
    let parent = match parent_path.filter(|path| !path.trim().is_empty()) {
        Some(path) => {
            let parent = PathBuf::from(path)
                .canonicalize()
                .map_err(|error| format!("找不到父目录：{error}"))?;
            if !parent.is_dir()
                || !parent.starts_with(&root)
                || parent.starts_with(internal_directory(&root))
            {
                return Err("父目录必须位于本地文献库中。".to_string());
            }
            parent
        }
        None => root.clone(),
    };
    if directory_contains_name(&parent, &name, cfg!(windows))? {
        return Err("当前目录已存在同名资源。".to_string());
    }
    let mut index = read_index(&root)?;
    let target = parent.join(&name);
    fs::create_dir(&target).map_err(|error| format!("无法创建文件夹：{error}"))?;
    index.revision = index.revision.saturating_add(1).max(1);
    if let Err(error) = write_index(&root, &index) {
        let rollback = fs::remove_dir(&target);
        return Err(match rollback {
            Ok(()) => format!("索引更新失败，新建目录已回滚：{error}"),
            Err(rollback_error) => {
                format!("索引更新失败且新建目录无法自动回滚：{error}；回滚错误：{rollback_error}")
            }
        });
    }
    let _ = register_local_operation(&app, &[target]);
    load_local_library_snapshot(app)
}

#[tauri::command]
pub fn ensure_local_library_relative_folder(
    app: AppHandle,
    relative_path: String,
) -> Result<String, String> {
    let root = library_root(&app)?;
    let mut index = read_index(&root)?;
    let (current, created) = ensure_relative_folder(&root, Path::new(relative_path.trim()))?;
    if !created.is_empty() {
        index.revision = index.revision.saturating_add(1).max(1);
        if let Err(error) = write_index(&root, &index) {
            for directory in created.iter().rev() {
                let _ = fs::remove_dir(directory);
            }
            return Err(format!("索引更新失败，新建目录层级已回滚：{error}"));
        }
        let _ = register_local_operation(&app, std::slice::from_ref(&current));
    }
    Ok(current.to_string_lossy().to_string())
}

fn ensure_relative_folder(
    root: &Path,
    requested: &Path,
) -> Result<(PathBuf, Vec<PathBuf>), String> {
    if requested.as_os_str().is_empty() {
        return Ok((root.to_path_buf(), Vec::new()));
    }

    let names = requested
        .components()
        .map(|component| {
            let Component::Normal(component_name) = component else {
                return Err("导入目录层级包含无效路径分量。".to_string());
            };
            let name = component_name
                .to_str()
                .ok_or_else(|| "导入目录名称必须是有效文本。".to_string())?;
            validate_folder_name(name)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut current = root.to_path_buf();
    let mut created = Vec::new();
    let result = (|| -> Result<PathBuf, String> {
        for name in names {
            let next = current.join(name);
            if next.exists() {
                let metadata = fs::symlink_metadata(&next)
                    .map_err(|error| format!("无法检查导入目录：{error}"))?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err("导入目录层级与现有资源冲突。".to_string());
                }
            } else {
                fs::create_dir(&next).map_err(|error| format!("无法创建导入目录：{error}"))?;
                created.push(next.clone());
            }
            let canonical = next
                .canonicalize()
                .map_err(|error| format!("无法访问导入目录：{error}"))?;
            if !canonical.starts_with(root) || canonical.starts_with(internal_directory(root)) {
                return Err("导入目录必须位于本地文献库中。".to_string());
            }
            current = canonical;
        }
        Ok(current.clone())
    })();
    match result {
        Ok(current) => Ok((current, created)),
        Err(error) => {
            for directory in created.iter().rev() {
                let _ = fs::remove_dir(directory);
            }
            Err(error)
        }
    }
}

fn path_is_same_or_child(candidate: &str, parent: &str) -> bool {
    candidate == parent || candidate.starts_with(&format!("{parent}/"))
}

fn next_trash_id(source_relative: &str) -> String {
    format!(
        "trash_{}_{}",
        unix_timestamp(),
        &hash_text(&format!(
            "{}:{}",
            source_relative,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))[..12]
    )
}

fn write_trash_manifest(directory: &Path, manifest: &LocalTrashManifest) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?;
    write_bytes_atomically(&directory.join("manifest.json"), &serialized)
}

fn manifest_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || path
            .components()
            .any(|component| component.as_os_str() == INTERNAL_DIRECTORY_NAME)
    {
        return Err("回收站清单包含无效的相对路径。".to_string());
    }
    Ok(path.to_path_buf())
}

fn artifact_references_for_entries(
    root: &Path,
    entries: &[LocalLibraryIndexEntry],
) -> Result<Vec<String>, String> {
    let mut references = Vec::new();
    for entry in entries {
        let directory_name = paper_artifact_directory_name(&entry.id)?;
        let directory = artifacts_directory(root).join(&directory_name);
        if directory.is_dir() {
            references.push(format!(
                "{INTERNAL_DIRECTORY_NAME}/{ARTIFACTS_DIRECTORY_NAME}/{directory_name}"
            ));
        }
    }
    references.sort();
    references.dedup();
    Ok(references)
}

fn move_artifacts_to_trash(
    root: &Path,
    trash_item: &Path,
    references: &[String],
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let trash_artifacts = trash_item.join("artifacts");
    let mut moved = Vec::new();
    for reference in references {
        let name = Path::new(reference)
            .file_name()
            .ok_or_else(|| "伴生数据引用无效。".to_string())?;
        let source = artifacts_directory(root).join(name);
        if !source.exists() {
            continue;
        }
        fs::create_dir_all(&trash_artifacts)
            .map_err(|error| format!("无法创建回收站伴生数据目录：{error}"))?;
        let target = trash_artifacts.join(name);
        if let Err(error) = fs::rename(&source, &target) {
            for (previous_source, previous_target) in moved.iter().rev() {
                let _ = fs::rename(previous_target, previous_source);
            }
            return Err(format!("无法移动文献伴生数据：{error}"));
        }
        moved.push((source, target));
    }
    Ok(moved)
}

fn trash_transaction_directory(root: &Path, trash_id: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(trash_operation_directory(root))
        .map_err(|error| format!("无法创建回收站事务目录：{error}"))?;
    let transaction = trash_operation_directory(root).join(format!("trash_{trash_id}"));
    fs::create_dir(&transaction).map_err(|error| format!("无法创建回收站删除事务：{error}"))?;
    Ok(transaction)
}

fn rollback_trash_error(
    root: &Path,
    transaction: &Path,
    marker: &TrashOperationMarker,
    error: String,
) -> String {
    match rollback_recovered_trash(root, transaction, marker) {
        Ok(()) => error,
        Err(rollback_error) => format!("{error}；自动回滚未完成：{rollback_error}"),
    }
}

#[tauri::command]
pub fn trash_local_library_resource(
    app: AppHandle,
    source_path: String,
) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app)?;
    let source = trash_resource_at_root(&root, &source_path)?;
    let _ = register_local_operation(&app, &[source]);
    scan_local_library_root(&root)
}

fn trash_resource_at_root(root: &Path, source_path: &str) -> Result<PathBuf, String> {
    let source = resolve_existing_resource(&root, &source_path)?;
    let source_relative = relative_path(&root, &source)?;
    let mut index = read_index(&root)?;
    let removed_entries = index
        .entries
        .iter()
        .filter(|entry| path_is_same_or_child(&entry.relative_path, &source_relative))
        .cloned()
        .collect::<Vec<_>>();
    let artifact_references = artifact_references_for_entries(&root, &removed_entries)?;
    let artifact_names = artifact_references
        .iter()
        .map(|reference| {
            Path::new(reference)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .ok_or_else(|| "伴生数据引用无效。".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let marker = ensure_library_marker(&root)?;
    let trash_id = next_trash_id(&source_relative);
    let transaction = trash_transaction_directory(root, &trash_id)?;
    let payload = transaction.join("payload");
    let trashed_at = unix_timestamp();
    let manifest = LocalTrashManifest {
        artifact_references: artifact_references.clone(),
        document_id: (removed_entries.len() == 1).then(|| removed_entries[0].id.clone()),
        index_entries: removed_entries.clone(),
        library_id: marker.library_id,
        metadata_entries: Vec::new(),
        node_type: if source.is_dir() {
            "folder"
        } else {
            "document"
        }
        .to_string(),
        original_relative_path: source_relative.clone(),
        payload_relative_path: Some("payload".to_string()),
        purge_after: trashed_at + TRASH_RETENTION_SECONDS,
        trash_id: trash_id.clone(),
        trashed_at,
    };
    if let Err(error) = write_trash_manifest(&transaction, &manifest) {
        let _ = fs::remove_dir_all(&transaction);
        return Err(error);
    }
    let transaction_id = transaction
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "回收站事务路径无效。".to_string())?;
    let operation = TrashOperationMarker {
        transaction_id: transaction_id.clone(),
        operation: "trash".to_string(),
        base_revision: index.revision,
        target_revision: index.revision.saturating_add(1).max(1),
        trash_ids: vec![trash_id],
        restore_target_relative: None,
        payload_relative_path: Some("payload".to_string()),
        artifact_names,
        restored_document_ids: Vec::new(),
        restored_metadata_ids: Vec::new(),
        affected_document_ids: removed_entries
            .iter()
            .map(|entry| entry.id.clone())
            .collect(),
        affected_metadata_ids: Vec::new(),
    };
    if let Err(error) = write_trash_operation_marker(&transaction, &operation) {
        let _ = fs::remove_dir_all(&transaction);
        return Err(error);
    }
    if let Err(error) = fs::rename(&source, &payload) {
        return Err(rollback_trash_error(
            root,
            &transaction,
            &operation,
            format!("无法将资源移入回收站：{error}"),
        ));
    }
    if let Err(error) = move_artifacts_to_trash(&root, &transaction, &artifact_references) {
        return Err(rollback_trash_error(root, &transaction, &operation, error));
    }

    index
        .entries
        .retain(|entry| !path_is_same_or_child(&entry.relative_path, &source_relative));
    record_committed_trash_operation(&mut index, &transaction_id);
    index.revision = index.revision.saturating_add(1).max(1);
    if let Err(error) = write_index(&root, &index) {
        return Err(rollback_trash_error(
            root,
            &transaction,
            &operation,
            format!("索引更新失败，删除操作未提交：{error}"),
        ));
    }
    finalize_committed_trash(root, &transaction, &operation)?;
    Ok(source)
}

#[tauri::command]
pub fn trash_local_metadata_entry(
    app: AppHandle,
    document_id: String,
) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app)?;
    let mut index = read_index(&root)?;
    let position = index
        .metadata_only
        .iter()
        .position(|entry| entry.id == document_id)
        .ok_or_else(|| "找不到仅元数据条目。".to_string())?;
    let entry = index.metadata_only.remove(position);
    let library_marker = ensure_library_marker(&root)?;
    let trash_id = next_trash_id(&entry.id);
    let transaction = trash_transaction_directory(&root, &trash_id)?;
    let trashed_at = unix_timestamp();
    let manifest = LocalTrashManifest {
        artifact_references: Vec::new(),
        document_id: Some(entry.id.clone()),
        index_entries: Vec::new(),
        library_id: library_marker.library_id,
        metadata_entries: vec![entry.clone()],
        node_type: "metadata_entry".to_string(),
        original_relative_path: format!("仅元数据/{}", entry.title),
        payload_relative_path: None,
        purge_after: trashed_at + TRASH_RETENTION_SECONDS,
        trash_id: trash_id.clone(),
        trashed_at,
    };
    if let Err(error) = write_trash_manifest(&transaction, &manifest) {
        let _ = fs::remove_dir_all(&transaction);
        return Err(error);
    }
    let transaction_id = transaction
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "回收站事务路径无效。".to_string())?;
    let operation = TrashOperationMarker {
        transaction_id: transaction_id.clone(),
        operation: "trash".to_string(),
        base_revision: index.revision,
        target_revision: index.revision.saturating_add(1).max(1),
        trash_ids: vec![trash_id],
        restore_target_relative: None,
        payload_relative_path: None,
        artifact_names: Vec::new(),
        restored_document_ids: Vec::new(),
        restored_metadata_ids: Vec::new(),
        affected_document_ids: Vec::new(),
        affected_metadata_ids: vec![entry.id.clone()],
    };
    if let Err(error) = write_trash_operation_marker(&transaction, &operation) {
        let _ = fs::remove_dir_all(&transaction);
        return Err(error);
    }
    let metadata_path = metadata_entry_path(&root, &entry.id)?;
    if let Err(error) = fs::rename(&metadata_path, transaction.join("metadata-entry.json")) {
        return Err(rollback_trash_error(
            &root,
            &transaction,
            &operation,
            format!("无法将仅元数据条目移入回收站：{error}"),
        ));
    }
    record_committed_trash_operation(&mut index, &transaction_id);
    index.revision = index.revision.saturating_add(1).max(1);
    if let Err(error) = write_index(&root, &index) {
        return Err(rollback_trash_error(
            &root,
            &transaction,
            &operation,
            format!("索引更新失败，仅元数据删除未提交：{error}"),
        ));
    }
    finalize_committed_trash(&root, &transaction, &operation)?;
    load_local_library_snapshot(app)
}

fn unique_restore_target(requested: &Path) -> Result<PathBuf, String> {
    unique_restore_target_with_case_rule(requested, cfg!(windows))
}

fn unique_restore_target_with_case_rule(
    requested: &Path,
    case_insensitive: bool,
) -> Result<PathBuf, String> {
    let parent = requested.parent().unwrap_or_else(|| Path::new(""));
    let requested_name = requested
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("恢复的资源");
    if !directory_contains_name(parent, requested_name, case_insensitive)? {
        return Ok(requested.to_path_buf());
    }
    let stem = requested
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("恢复的资源");
    let extension = requested.extension().and_then(|value| value.to_str());
    for sequence in 2..10000 {
        let name = match extension {
            Some(extension) => format!("{stem} ({sequence}).{extension}"),
            None => format!("{stem} ({sequence})"),
        };
        let candidate = parent.join(&name);
        if !directory_contains_name(parent, &name, case_insensitive)? {
            return Ok(candidate);
        }
    }
    Ok(parent.join(format!("{stem} ({})", unix_timestamp())))
}

fn trash_id_is_valid(trash_id: &str) -> bool {
    !trash_id.is_empty()
        && trash_id.len() <= 128
        && trash_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn resolve_trash_item(root: &Path, trash_id: &str) -> Result<PathBuf, String> {
    if !trash_id_is_valid(trash_id) {
        return Err("回收站条目标识无效。".to_string());
    }
    let item = trash_directory(root).join(trash_id);
    if !item.is_dir() {
        return Err("找不到回收站条目。".to_string());
    }
    Ok(item)
}

fn write_trash_operation_marker(
    transaction: &Path,
    marker: &TrashOperationMarker,
) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(marker).map_err(|error| error.to_string())?;
    write_bytes_atomically(
        &transaction.join(TRASH_OPERATION_MARKER_FILE_NAME),
        &serialized,
    )
    .map_err(|error| format!("无法保存回收站事务状态：{error}"))
}

fn same_unique_values(left: &[String], right: &[String]) -> bool {
    let left_values = left.iter().map(String::as_str).collect::<HashSet<_>>();
    let right_values = right.iter().map(String::as_str).collect::<HashSet<_>>();
    left_values.len() == left.len()
        && right_values.len() == right.len()
        && left_values == right_values
}

fn validate_trash_operation_marker(
    root: &Path,
    transaction: &Path,
    marker: &TrashOperationMarker,
) -> Result<(), String> {
    let transaction_id = transaction
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "回收站事务目录名称无效。".to_string())?;
    if marker.transaction_id != transaction_id
        || marker.target_revision != marker.base_revision.saturating_add(1).max(1)
        || marker.trash_ids.is_empty()
        || !marker.trash_ids.iter().all(|id| trash_id_is_valid(id))
        || marker.trash_ids.iter().collect::<HashSet<_>>().len() != marker.trash_ids.len()
        || !matches!(marker.operation.as_str(), "trash" | "restore" | "purge")
    {
        return Err("回收站事务状态不自洽，已停止自动修复以保护数据。".to_string());
    }

    let artifact_names = marker
        .artifact_names
        .iter()
        .map(|name| {
            let relative = manifest_relative_path(name)?;
            (relative.components().count() == 1)
                .then_some(name.clone())
                .ok_or_else(|| "回收站事务包含无效的伴生数据名称。".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !same_unique_values(&marker.artifact_names, &artifact_names) {
        return Err("回收站事务包含重复的伴生数据名称。".to_string());
    }

    if marker.operation == "purge" {
        if marker.restore_target_relative.is_some()
            || marker.payload_relative_path.is_some()
            || !marker.artifact_names.is_empty()
            || !marker.restored_document_ids.is_empty()
            || !marker.restored_metadata_ids.is_empty()
            || !marker.affected_document_ids.is_empty()
            || !marker.affected_metadata_ids.is_empty()
        {
            return Err("永久删除事务状态包含不应存在的恢复字段。".to_string());
        }
        return Ok(());
    }

    if marker.trash_ids.len() != 1 {
        return Err("回收站删除或恢复事务只能引用一个回收站条目。".to_string());
    }
    let manifest = read_trash_manifest(&transaction.join("manifest.json"))?;
    let library = ensure_library_marker(root)?;
    if manifest.trash_id != marker.trash_ids[0] || manifest.library_id != library.library_id {
        return Err("回收站事务清单与当前文献库或事务状态不匹配。".to_string());
    }
    match manifest.node_type.as_str() {
        "metadata_entry" => {
            if manifest.payload_relative_path.is_some()
                || !manifest.index_entries.is_empty()
                || !manifest.artifact_references.is_empty()
                || manifest.metadata_entries.is_empty()
            {
                return Err("仅元数据回收站清单包含不一致的正文或伴生数据。".to_string());
            }
        }
        "document" | "folder" => {
            manifest_relative_path(&manifest.original_relative_path)?;
            if manifest.payload_relative_path.is_none() || !manifest.metadata_entries.is_empty() {
                return Err("文件或目录回收站清单缺少正文或混入仅元数据条目。".to_string());
            }
        }
        _ => return Err("回收站清单包含未知资源类型。".to_string()),
    }
    let manifest_payload = manifest
        .payload_relative_path
        .as_deref()
        .map(manifest_relative_path)
        .transpose()?
        .map(|path| path.to_string_lossy().replace('\\', "/"));
    let marker_payload = marker
        .payload_relative_path
        .as_deref()
        .map(manifest_relative_path)
        .transpose()?
        .map(|path| path.to_string_lossy().replace('\\', "/"));
    if manifest_payload != marker_payload {
        return Err("回收站事务正文路径与清单不匹配。".to_string());
    }
    let manifest_artifact_names = manifest
        .artifact_references
        .iter()
        .map(|reference| {
            let components = Path::new(reference).components().collect::<Vec<_>>();
            if components.len() != 3
                || components[0].as_os_str() != INTERNAL_DIRECTORY_NAME
                || components[1].as_os_str() != ARTIFACTS_DIRECTORY_NAME
            {
                return Err("回收站清单包含无效的伴生数据引用。".to_string());
            }
            components[2]
                .as_os_str()
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| "回收站清单包含无效的伴生数据引用。".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !same_unique_values(&marker.artifact_names, &manifest_artifact_names) {
        return Err("回收站事务伴生数据与清单不匹配。".to_string());
    }
    let document_ids = manifest
        .index_entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    let metadata_ids = manifest
        .metadata_entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    for entry in &manifest.index_entries {
        if !path_is_same_or_child(&entry.relative_path, &manifest.original_relative_path) {
            return Err("回收站清单包含不属于原始资源的文献路径。".to_string());
        }
    }
    for entry in &manifest.metadata_entries {
        metadata_entry_path(root, &entry.id)?;
    }

    if marker.operation == "trash" {
        if marker.restore_target_relative.is_some()
            || !marker.restored_document_ids.is_empty()
            || !marker.restored_metadata_ids.is_empty()
            || !same_unique_values(&marker.affected_document_ids, &document_ids)
            || !same_unique_values(&marker.affected_metadata_ids, &metadata_ids)
        {
            return Err("回收站删除事务的受影响资源与清单不匹配。".to_string());
        }
    } else {
        if !marker.affected_document_ids.is_empty()
            || !marker.affected_metadata_ids.is_empty()
            || !same_unique_values(&marker.restored_document_ids, &document_ids)
            || !same_unique_values(&marker.restored_metadata_ids, &metadata_ids)
            || marker.restore_target_relative.is_some() != marker.payload_relative_path.is_some()
        {
            return Err("回收站恢复事务的目标资源与清单不匹配。".to_string());
        }
        if let Some(target) = marker.restore_target_relative.as_deref() {
            manifest_relative_path(target)?;
        }
    }
    Ok(())
}

fn trash_operation_is_committed(index: &LocalLibraryIndex, marker: &TrashOperationMarker) -> bool {
    if index.revision < marker.target_revision
        || !index
            .committed_trash_operations
            .contains(&marker.transaction_id)
    {
        return false;
    }
    match marker.operation.as_str() {
        "purge" => true,
        "trash" => {
            marker
                .affected_document_ids
                .iter()
                .all(|id| !index.entries.iter().any(|entry| entry.id == *id))
                && marker
                    .affected_metadata_ids
                    .iter()
                    .all(|id| !index.metadata_only.iter().any(|entry| entry.id == *id))
        }
        "restore" => {
            marker.restored_document_ids.iter().all(|id| {
                index.entries.iter().any(|entry| {
                    entry.id == *id
                        && marker
                            .restore_target_relative
                            .as_ref()
                            .is_some_and(|target| {
                                entry.relative_path == *target
                                    || entry
                                        .relative_path
                                        .strip_prefix(target)
                                        .is_some_and(|suffix| suffix.starts_with('/'))
                            })
                })
            }) && marker
                .restored_metadata_ids
                .iter()
                .all(|id| index.metadata_only.iter().any(|entry| entry.id == *id))
        }
        _ => false,
    }
}

fn finalize_committed_trash(
    root: &Path,
    transaction: &Path,
    marker: &TrashOperationMarker,
) -> Result<(), String> {
    let trash_id = marker
        .trash_ids
        .first()
        .ok_or_else(|| "回收站删除事务缺少条目标识。".to_string())?;
    let destination = trash_directory(root).join(trash_id);
    if destination.exists() {
        return Err("已提交的回收站删除事务与现有条目冲突，已停止自动修复。".to_string());
    }
    fs::remove_file(transaction.join(TRASH_OPERATION_MARKER_FILE_NAME))
        .map_err(|error| format!("无法完成回收站删除事务：{error}"))?;
    fs::rename(transaction, destination)
        .map_err(|error| format!("无法发布已提交的回收站条目：{error}"))
}

fn rollback_recovered_trash(
    root: &Path,
    transaction: &Path,
    marker: &TrashOperationMarker,
) -> Result<(), String> {
    let manifest = read_trash_manifest(&transaction.join("manifest.json"))?;
    let payload_restore = if let Some(payload_relative) = manifest.payload_relative_path.as_deref()
    {
        let payload = transaction.join(manifest_relative_path(payload_relative)?);
        let source = root.join(manifest_relative_path(&manifest.original_relative_path)?);
        match (payload.exists(), source.exists()) {
            (true, false) => Some((payload, source)),
            (false, true) => None,
            (true, true) => {
                return Err("未提交的回收站删除事务与现有源资源冲突，已停止自动修复。".to_string());
            }
            (false, false) => {
                return Err(
                    "未提交的回收站删除事务缺少正文和原始资源，已停止自动修复。".to_string()
                );
            }
        }
    } else {
        None
    };
    let mut artifact_restores = Vec::new();
    for name in &marker.artifact_names {
        let relative = manifest_relative_path(name)?;
        if relative.components().count() != 1 {
            return Err("回收站事务包含无效的伴生数据名称。".to_string());
        }
        let staged = transaction.join("artifacts").join(&relative);
        let target = artifacts_directory(root).join(&relative);
        match (staged.exists(), target.exists()) {
            (true, false) => artifact_restores.push((staged, target)),
            (false, true) => {}
            (true, true) => {
                return Err(
                    "未提交的回收站删除事务与现有伴生数据冲突，已停止自动修复。".to_string()
                );
            }
            (false, false) => {
                return Err("未提交的回收站删除事务缺少伴生数据，已停止自动修复。".to_string());
            }
        }
    }
    let mut metadata_restores = Vec::new();
    for entry in &manifest.metadata_entries {
        let target = metadata_entry_path(root, &entry.id)?;
        if target.exists() {
            let serialized = fs::read_to_string(&target)
                .map_err(|error| format!("无法核对已恢复的仅元数据条目：{error}"))?;
            let existing: MetadataOnlyEntry = serde_json::from_str(&serialized)
                .map_err(|error| format!("已恢复的仅元数据条目损坏：{error}"))?;
            if existing != *entry {
                return Err(
                    "未提交的回收站删除事务与现有仅元数据条目冲突，已停止自动修复。".to_string(),
                );
            }
        } else {
            metadata_restores.push(entry);
        }
    }

    if let Some((payload, source)) = payload_restore {
        if let Some(parent) = source.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&payload, &source)
            .map_err(|error| format!("无法回滚未提交的回收站正文：{error}"))?;
    }
    for (staged, target) in artifact_restores {
        fs::rename(&staged, &target)
            .map_err(|error| format!("无法回滚未提交的回收站伴生数据：{error}"))?;
    }
    for entry in metadata_restores {
        write_metadata_entry(root, entry)?;
    }
    fs::remove_file(transaction.join(TRASH_OPERATION_MARKER_FILE_NAME))
        .map_err(|error| format!("无法清理未提交的回收站删除状态：{error}"))?;
    fs::remove_dir_all(transaction)
        .map_err(|error| format!("无法清理已回滚的回收站删除事务：{error}"))
}

fn record_committed_trash_operation(index: &mut LocalLibraryIndex, transaction_id: &str) {
    index
        .committed_trash_operations
        .retain(|candidate| candidate != transaction_id);
    index
        .committed_trash_operations
        .push(transaction_id.to_string());
    if index.committed_trash_operations.len() > 64 {
        index
            .committed_trash_operations
            .drain(..index.committed_trash_operations.len() - 64);
    }
}

fn rollback_recovered_restore(
    root: &Path,
    transaction: &Path,
    marker: &TrashOperationMarker,
) -> Result<(), String> {
    let trash_id = marker
        .trash_ids
        .first()
        .ok_or_else(|| "回收站恢复事务缺少条目标识。".to_string())?;
    let destination = trash_directory(root).join(trash_id);
    if destination.exists() {
        return Err("未提交的回收站恢复事务与现有条目冲突，已停止自动修复。".to_string());
    }
    let payload_rollback = if let (Some(target_relative), Some(payload_relative)) = (
        marker.restore_target_relative.as_deref(),
        marker.payload_relative_path.as_deref(),
    ) {
        let target = root.join(manifest_relative_path(target_relative)?);
        let payload = transaction.join(manifest_relative_path(payload_relative)?);
        match (target.exists(), payload.exists()) {
            (true, false) => Some((target, payload)),
            (false, true) => None,
            (true, true) => {
                return Err(
                    "未提交的回收站恢复事务同时包含恢复正文和暂存正文，已停止自动修复。"
                        .to_string(),
                );
            }
            (false, false) => {
                return Err("未提交的回收站恢复事务缺少正文，已停止自动修复。".to_string());
            }
        }
    } else {
        None
    };
    let mut artifact_rollbacks = Vec::new();
    for name in &marker.artifact_names {
        let relative = manifest_relative_path(name)?;
        if relative.components().count() != 1 {
            return Err("回收站事务包含无效的伴生数据名称。".to_string());
        }
        let artifact = artifacts_directory(root).join(&relative);
        let staged = transaction.join("artifacts").join(&relative);
        match (artifact.exists(), staged.exists()) {
            (true, false) => artifact_rollbacks.push((artifact, staged)),
            (false, true) => {}
            (true, true) => {
                return Err(
                    "未提交的回收站恢复事务包含冲突的伴生数据，已停止自动修复。".to_string()
                );
            }
            (false, false) => {
                return Err("未提交的回收站恢复事务缺少伴生数据，已停止自动修复。".to_string());
            }
        }
    }
    let manifest = read_trash_manifest(&transaction.join("manifest.json"))?;
    let mut metadata_rollbacks = Vec::new();
    for id in &marker.restored_metadata_ids {
        let path = metadata_entry_path(root, id)?;
        if !path.exists() {
            continue;
        }
        let expected = manifest
            .metadata_entries
            .iter()
            .find(|entry| entry.id == *id)
            .ok_or_else(|| "回收站恢复事务缺少仅元数据清单。".to_string())?;
        let serialized = fs::read_to_string(&path)
            .map_err(|error| format!("无法核对待回滚的仅元数据条目：{error}"))?;
        let existing: MetadataOnlyEntry = serde_json::from_str(&serialized)
            .map_err(|error| format!("待回滚的仅元数据条目损坏：{error}"))?;
        if existing != *expected {
            return Err(
                "未提交的回收站恢复事务与现有仅元数据条目冲突，已停止自动修复。".to_string(),
            );
        }
        metadata_rollbacks.push(path);
    }

    if let Some((target, payload)) = payload_rollback {
        if let Some(parent) = payload.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(&target, &payload)
            .map_err(|error| format!("无法回滚未提交的回收站恢复正文：{error}"))?;
    }
    for (artifact, staged) in artifact_rollbacks {
        fs::create_dir_all(transaction.join("artifacts")).map_err(|error| error.to_string())?;
        fs::rename(&artifact, &staged)
            .map_err(|error| format!("无法回滚未提交的回收站恢复伴生数据：{error}"))?;
    }
    for path in metadata_rollbacks {
        fs::remove_file(path).map_err(|error| format!("无法回滚未提交的仅元数据恢复：{error}"))?;
    }
    let _ = fs::remove_file(transaction.join(TRASH_OPERATION_MARKER_FILE_NAME));
    fs::rename(transaction, destination)
        .map_err(|error| format!("无法放回未提交的回收站恢复事务：{error}"))
}

fn recover_trash_operations(root: &Path) -> Result<(), String> {
    let operations = trash_operation_directory(root);
    fs::create_dir_all(&operations).map_err(|error| format!("无法创建回收站事务目录：{error}"))?;
    let index = read_index(root)?;
    for item in
        fs::read_dir(&operations).map_err(|error| format!("无法检查回收站事务目录：{error}"))?
    {
        let item = item.map_err(|error| error.to_string())?;
        if !item
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            return Err("回收站事务目录包含未知资源，已停止自动修复。".to_string());
        }
        let transaction = item.path();
        let marker_path = transaction.join(TRASH_OPERATION_MARKER_FILE_NAME);
        if marker_path.is_file() {
            let serialized = fs::read_to_string(&marker_path)
                .map_err(|error| format!("无法读取回收站事务状态：{error}"))?;
            let marker: TrashOperationMarker = serde_json::from_str(&serialized)
                .map_err(|error| format!("回收站事务状态损坏，已停止自动修复：{error}"))?;
            validate_trash_operation_marker(root, &transaction, &marker)?;
            if trash_operation_is_committed(&index, &marker) {
                if marker.operation == "trash" {
                    finalize_committed_trash(root, &transaction, &marker)?;
                } else {
                    fs::remove_dir_all(&transaction)
                        .map_err(|error| format!("无法清理已提交的回收站事务：{error}"))?;
                }
            } else if marker.operation == "trash" {
                rollback_recovered_trash(root, &transaction, &marker)?;
            } else if marker.operation == "restore" {
                rollback_recovered_restore(root, &transaction, &marker)?;
            } else if marker.operation == "purge" {
                let mut staged_rollbacks = Vec::new();
                for trash_id in &marker.trash_ids {
                    let staged = transaction.join(trash_id);
                    let destination = trash_directory(root).join(trash_id);
                    match (staged.exists(), destination.exists()) {
                        (true, false) => staged_rollbacks.push((staged, destination)),
                        (false, true) => {}
                        (true, true) => {
                            return Err("未提交的永久删除事务与现有回收站条目冲突。".to_string());
                        }
                        (false, false) => {
                            return Err(
                                "未提交的永久删除事务缺少回收站条目，已停止自动修复。".to_string()
                            );
                        }
                    }
                }
                for (staged, destination) in staged_rollbacks {
                    fs::rename(staged, destination)
                        .map_err(|error| format!("无法回滚未提交的永久删除事务：{error}"))?;
                }
                fs::remove_dir_all(&transaction)
                    .map_err(|error| format!("无法清理已回滚的永久删除事务：{error}"))?;
            } else {
                return Err("回收站事务包含未知操作，已停止自动修复。".to_string());
            }
            continue;
        }

        // Compatibility for the narrow crash window of older builds that staged a
        // restore before they could persist an operation marker.
        if transaction.join("manifest.json").is_file() {
            let manifest = read_trash_manifest(&transaction.join("manifest.json"))?;
            let payload_exists = manifest
                .payload_relative_path
                .as_deref()
                .map(manifest_relative_path)
                .transpose()?
                .is_some_and(|path| transaction.join(path).exists());
            let source_is_active = manifest.index_entries.iter().any(|entry| {
                index
                    .entries
                    .iter()
                    .any(|candidate| candidate.id == entry.id)
            }) || manifest.metadata_entries.iter().any(|entry| {
                index
                    .metadata_only
                    .iter()
                    .any(|candidate| candidate.id == entry.id)
            });
            if !payload_exists && source_is_active {
                fs::remove_dir_all(&transaction)
                    .map_err(|error| format!("无法清理未开始的回收站事务：{error}"))?;
                continue;
            }
            let destination = trash_directory(root).join(&manifest.trash_id);
            if destination.exists() {
                return Err("旧回收站恢复事务与现有条目冲突，已停止自动修复。".to_string());
            }
            fs::rename(&transaction, destination)
                .map_err(|error| format!("无法恢复旧回收站事务：{error}"))?;
        } else {
            return Err("回收站事务缺少状态清单，已停止自动修复以保护数据。".to_string());
        }
    }
    Ok(())
}

fn stage_trash_operation(
    root: &Path,
    trash_item: &Path,
    operation: &str,
) -> Result<PathBuf, String> {
    let name = trash_item
        .file_name()
        .ok_or_else(|| "回收站条目路径无效。".to_string())?;
    let transaction = trash_operation_directory(root).join(format!(
        "{}_{}_{}",
        operation,
        name.to_string_lossy(),
        unix_timestamp_ms()
    ));
    fs::create_dir_all(trash_operation_directory(root))
        .map_err(|error| format!("无法创建回收站事务目录：{error}"))?;
    fs::rename(trash_item, &transaction).map_err(|error| format!("无法暂存回收站条目：{error}"))?;
    Ok(transaction)
}

fn rollback_trash_operation(staged: &Path, trash_item: &Path) {
    let _ = fs::remove_file(staged.join(TRASH_OPERATION_MARKER_FILE_NAME));
    if let Err(error) = fs::rename(staged, trash_item) {
        eprintln!("Unable to roll back local trash transaction: {error}");
    }
}

fn cleanup_committed_trash_operation(staged: &Path) {
    if let Err(error) = fs::remove_dir_all(staged) {
        eprintln!("Unable to clean committed local trash transaction: {error}");
    }
}

#[tauri::command]
pub fn restore_local_library_trash_item(
    app: AppHandle,
    trash_id: String,
) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app)?;
    let restored = restore_trash_at_root(&root, &trash_id)?;
    if let Some(target) = restored {
        let _ = register_local_operation(&app, &[target]);
    }
    scan_local_library_root(&root)
}

fn restore_trash_at_root(root: &Path, trash_id: &str) -> Result<Option<PathBuf>, String> {
    let trash_item = resolve_trash_item(&root, &trash_id)?;
    let manifest = read_trash_manifest(&trash_item.join("manifest.json"))?;
    let marker = ensure_library_marker(&root)?;
    if !manifest.library_id.is_empty() && manifest.library_id != marker.library_id {
        return Err("回收站条目不属于当前本地文献库。".to_string());
    }
    let mut index = read_index(&root)?;

    if manifest.node_type == "metadata_entry" {
        let base_revision = index.revision;
        let metadata_entries = manifest
            .metadata_entries
            .into_iter()
            .map(|entry| metadata_entry_path(&root, &entry.id).map(|path| (entry, path)))
            .collect::<Result<Vec<_>, _>>()?;
        let staged = stage_trash_operation(root, &trash_item, "restore")?;
        let transaction_id = staged
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .ok_or_else(|| "回收站事务路径无效。".to_string())?;
        let marker = TrashOperationMarker {
            transaction_id: transaction_id.clone(),
            operation: "restore".to_string(),
            base_revision,
            target_revision: base_revision.saturating_add(1).max(1),
            trash_ids: vec![trash_id.to_string()],
            restore_target_relative: None,
            payload_relative_path: None,
            artifact_names: Vec::new(),
            restored_document_ids: Vec::new(),
            restored_metadata_ids: metadata_entries
                .iter()
                .map(|(entry, _)| entry.id.clone())
                .collect(),
            affected_document_ids: Vec::new(),
            affected_metadata_ids: Vec::new(),
        };
        if let Err(error) = write_trash_operation_marker(&staged, &marker) {
            rollback_trash_operation(&staged, &trash_item);
            return Err(error);
        }
        let mut created_paths = Vec::new();
        for (entry, path) in metadata_entries {
            if !index
                .metadata_only
                .iter()
                .any(|candidate| candidate.id == entry.id)
            {
                if let Err(error) = write_metadata_entry(&root, &entry) {
                    for created_path in created_paths {
                        let _ = fs::remove_file(created_path);
                    }
                    rollback_trash_operation(&staged, &trash_item);
                    return Err(error);
                }
                created_paths.push(path);
                index.metadata_only.push(entry);
            }
        }
        record_committed_trash_operation(&mut index, &transaction_id);
        index.revision = index.revision.saturating_add(1).max(1);
        if let Err(error) = write_index(&root, &index) {
            for path in created_paths {
                let _ = fs::remove_file(path);
            }
            rollback_trash_operation(&staged, &trash_item);
            return Err(error);
        }
        cleanup_committed_trash_operation(&staged);
        return Ok(None);
    }

    let requested = root.join(manifest_relative_path(&manifest.original_relative_path)?);
    let parent = requested
        .parent()
        .ok_or_else(|| "原始恢复路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法重建原始目录：{error}"))?;
    let target = unique_restore_target(&requested)?;
    let payload_name = manifest
        .payload_relative_path
        .as_deref()
        .unwrap_or("payload");
    let payload_relative = manifest_relative_path(payload_name)?;
    let restored_relative = relative_path(&root, &target)?;
    let artifact_names = manifest
        .artifact_references
        .iter()
        .map(|reference| {
            Path::new(reference)
                .file_name()
                .map(|name| name.to_os_string())
                .ok_or_else(|| "伴生数据引用无效。".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    for name in &artifact_names {
        if artifacts_directory(&root).join(name).exists() {
            return Err("恢复目标存在同一文献的伴生数据，未覆盖现有数据。".to_string());
        }
    }

    let staged = stage_trash_operation(root, &trash_item, "restore")?;
    let transaction_id = staged
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "回收站事务路径无效。".to_string())?;
    let marker = TrashOperationMarker {
        transaction_id: transaction_id.clone(),
        operation: "restore".to_string(),
        base_revision: index.revision,
        target_revision: index.revision.saturating_add(1).max(1),
        trash_ids: vec![trash_id.to_string()],
        restore_target_relative: Some(restored_relative.clone()),
        payload_relative_path: Some(payload_relative.to_string_lossy().replace('\\', "/")),
        artifact_names: artifact_names
            .iter()
            .map(|name| name.to_string_lossy().to_string())
            .collect(),
        restored_document_ids: manifest
            .index_entries
            .iter()
            .map(|entry| entry.id.clone())
            .collect(),
        restored_metadata_ids: Vec::new(),
        affected_document_ids: Vec::new(),
        affected_metadata_ids: Vec::new(),
    };
    if let Err(error) = write_trash_operation_marker(&staged, &marker) {
        rollback_trash_operation(&staged, &trash_item);
        return Err(error);
    }
    let payload = staged.join(payload_relative);
    if let Err(error) = fs::rename(&payload, &target) {
        rollback_trash_operation(&staged, &trash_item);
        return Err(format!("无法恢复资源：{error}"));
    }
    let mut restored_artifacts = Vec::new();
    for name in artifact_names {
        let source = staged.join("artifacts").join(&name);
        if !source.exists() {
            continue;
        }
        let artifact_target = artifacts_directory(&root).join(name);
        if let Err(error) = fs::rename(&source, &artifact_target) {
            let _ = fs::rename(&target, &payload);
            for (restored_source, restored_target) in restored_artifacts.iter().rev() {
                let _ = fs::rename(restored_target, restored_source);
            }
            rollback_trash_operation(&staged, &trash_item);
            return Err(format!("无法恢复文献伴生数据：{error}"));
        }
        restored_artifacts.push((source, artifact_target));
    }
    for mut entry in manifest.index_entries {
        if entry.relative_path == manifest.original_relative_path {
            entry.relative_path = restored_relative.clone();
        } else if let Some(suffix) = entry
            .relative_path
            .strip_prefix(&format!("{}/", manifest.original_relative_path))
        {
            entry.relative_path = format!("{restored_relative}/{suffix}");
        }
        index.entries.retain(|candidate| candidate.id != entry.id);
        index.entries.push(entry);
    }
    record_committed_trash_operation(&mut index, &transaction_id);
    index.revision = index.revision.saturating_add(1).max(1);
    if let Err(error) = write_index(&root, &index) {
        for (source, artifact_target) in restored_artifacts.iter().rev() {
            let _ = fs::rename(artifact_target, source);
        }
        let _ = fs::rename(&target, &payload);
        rollback_trash_operation(&staged, &trash_item);
        return Err(format!("恢复后索引更新失败，资源已尝试放回回收站：{error}"));
    }
    cleanup_committed_trash_operation(&staged);
    Ok(Some(target))
}

fn purge_trash_items_with_index_writer<F>(
    root: &Path,
    trash_items: Vec<PathBuf>,
    write_next_index: F,
) -> Result<(), String>
where
    F: FnOnce(&LocalLibraryIndex) -> Result<(), String>,
{
    if trash_items.is_empty() {
        return Ok(());
    }
    let mut index = read_index(root)?;
    let transaction_id = format!(
        "purge_{}_{}",
        unix_timestamp(),
        &hash_text(&format!("{}:{}", root.display(), unix_timestamp_ms()))[..12]
    );
    let transaction = trash_operation_directory(root).join(transaction_id);
    fs::create_dir_all(&transaction)
        .map_err(|error| format!("无法创建回收站事务暂存目录：{error}"))?;

    let trash_ids = trash_items
        .iter()
        .map(|item| {
            item.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .ok_or_else(|| "回收站条目路径无效。".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let marker = TrashOperationMarker {
        transaction_id: transaction
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .ok_or_else(|| "回收站事务路径无效。".to_string())?,
        operation: "purge".to_string(),
        base_revision: index.revision,
        target_revision: index.revision.saturating_add(1).max(1),
        trash_ids,
        restore_target_relative: None,
        payload_relative_path: None,
        artifact_names: Vec::new(),
        restored_document_ids: Vec::new(),
        restored_metadata_ids: Vec::new(),
        affected_document_ids: Vec::new(),
        affected_metadata_ids: Vec::new(),
    };
    if let Err(error) = write_trash_operation_marker(&transaction, &marker) {
        let _ = fs::remove_dir_all(&transaction);
        return Err(error);
    }

    let mut staged = Vec::new();
    for source in trash_items {
        let name = source
            .file_name()
            .ok_or_else(|| "回收站条目路径无效。".to_string())?;
        let target = transaction.join(name);
        if let Err(error) = fs::rename(&source, &target) {
            for (rollback_source, rollback_target) in staged.iter().rev() {
                let _ = fs::rename(rollback_target, rollback_source);
            }
            let _ = fs::remove_dir_all(&transaction);
            return Err(format!("无法暂存待永久删除的回收站条目：{error}"));
        }
        staged.push((source, target));
    }

    record_committed_trash_operation(&mut index, &marker.transaction_id);
    index.revision = index.revision.saturating_add(1).max(1);
    if let Err(error) = write_next_index(&index) {
        for (source, target) in staged.iter().rev() {
            let _ = fs::rename(target, source);
        }
        let _ = fs::remove_dir_all(&transaction);
        return Err(format!("永久删除未提交，回收站条目已回滚：{error}"));
    }

    // The logical transaction is committed once the index is durable. A locked file may
    // delay physical cleanup on Windows; the staged data stays outside the visible trash
    // and can be removed by maintenance without reporting a committed delete as failed.
    if let Err(error) = fs::remove_dir_all(&transaction) {
        eprintln!("Unable to clean committed local trash transaction: {error}");
    }
    Ok(())
}

fn purge_trash_items_at_root(root: &Path, trash_items: Vec<PathBuf>) -> Result<(), String> {
    purge_trash_items_with_index_writer(root, trash_items, |index| write_index(root, index))
}

#[tauri::command]
pub fn purge_local_library_trash_item(
    app: AppHandle,
    trash_id: String,
) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app)?;
    let trash_item = resolve_trash_item(&root, &trash_id)?;
    purge_trash_items_at_root(&root, vec![trash_item])?;
    load_local_library_snapshot(app)
}

#[tauri::command]
pub fn empty_local_library_trash(app: AppHandle) -> Result<LocalLibrarySnapshot, String> {
    let root = library_root(&app)?;
    let trash = trash_directory(&root);
    let mut trash_items = Vec::new();
    for entry in fs::read_dir(&trash).map_err(|error| format!("无法读取本地回收站：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            trash_items.push(entry.path());
        }
    }
    purge_trash_items_at_root(&root, trash_items)?;
    load_local_library_snapshot(app)
}

fn purge_expired_trash_at(root: &Path, now: u64) -> Result<usize, String> {
    let mut expired = Vec::new();
    for entry in fs::read_dir(trash_directory(root))
        .map_err(|error| format!("无法读取本地回收站：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        let manifest = read_trash_manifest(&manifest_path)?;
        if manifest.purge_after <= now {
            expired.push(entry.path());
        }
    }
    let purged = expired.len();
    purge_trash_items_at_root(root, expired)?;
    Ok(purged)
}

fn purge_expired_trash(root: &Path) -> Result<(), String> {
    purge_expired_trash_at(root, unix_timestamp()).map(|_| ())
}

#[tauri::command]
pub fn list_legacy_local_library_roots(app: AppHandle) -> Result<Vec<String>, String> {
    if read_root_override(&app)?.is_some() {
        return Ok(Vec::new());
    }
    Ok(legacy_root_candidates(&app)?
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

fn watched_path_is_relevant(path: &Path) -> bool {
    !path
        .components()
        .any(|component| component.as_os_str() == INTERNAL_DIRECTORY_NAME)
        && path.file_name().and_then(|name| name.to_str()) != Some(LIBRARY_MARKER_FILE_NAME)
        && path.file_name().and_then(|name| name.to_str()) != Some(LEGACY_PROFILE_MARKER_FILE_NAME)
}

pub fn restart_local_library_watcher(app: &AppHandle) -> Result<(), String> {
    let root = library_root(app)?;
    let state: State<'_, LocalLibraryWatchState> = app.state();
    let (sender, receiver) = mpsc::channel::<LocalLibraryWatchSignal>();
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                let external_deletion = matches!(event.kind, EventKind::Remove(_));
                let relevant = event
                    .paths
                    .into_iter()
                    .filter(|path| watched_path_is_relevant(path))
                    .collect::<Vec<_>>();
                if !relevant.is_empty() {
                    let _ = sender.send(LocalLibraryWatchSignal::Change {
                        external_deletion,
                        paths: relevant,
                    });
                }
            }
            Err(error) => {
                let _ = sender.send(LocalLibraryWatchSignal::Error(error.to_string()));
            }
        })
        .map_err(|error| format!("无法启动本地文献库监听：{error}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("无法监听本地文献库：{error}"))?;

    let event_app = app.clone();
    thread::spawn(move || {
        while let Ok(first) = receiver.recv() {
            let mut batch = LocalLibraryWatchBatch::default();
            batch.merge(first);
            while let Ok(next) = receiver.recv_timeout(Duration::from_millis(250)) {
                batch.merge(next);
            }
            let paths = batch.normalized_paths();
            let serialized = paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>();
            if !batch.watcher_errors.is_empty() {
                let trace_id = format!(
                    "trace_{}",
                    &hash_text(&format!("watch:{}", unix_timestamp()))[..24]
                );
                eprintln!(
                    "Local library watcher error ({trace_id}): {}",
                    batch.watcher_errors.join("; ")
                );
                let _ = event_app.emit(
                    "local-library-watch-error",
                    LocalLibraryWatchErrorEvent {
                        code: "local_library_watch_failed".to_string(),
                        message: "本地文献库监听暂时不可用，已尝试完整刷新。".to_string(),
                        trace_id,
                    },
                );
            }
            let operation_id =
                matching_local_operation_id(&event_app, &paths).unwrap_or_else(|error| {
                    eprintln!("Unable to match local operation echo: {error}");
                    None
                });
            let incremental = batch.watcher_errors.is_empty();
            let scan_result = if incremental {
                scan_local_library_paths(&root, &paths).map(|snapshot| (snapshot, false))
            } else {
                scan_local_library_root(&root).map(|snapshot| (snapshot, true))
            };
            let scan_result = scan_result.or_else(|incremental_error| {
                if incremental {
                    eprintln!(
                        "Incremental local library scan fell back to full validation: {incremental_error}"
                    );
                    scan_local_library_root(&root).map(|snapshot| (snapshot, true))
                } else {
                    Err(incremental_error)
                }
            });
            match scan_result {
                Ok((snapshot, full_rescan)) => {
                    let revision = snapshot.revision;
                    let _ = event_app.emit(
                        "local-library-changed",
                        LocalLibraryChangedEvent {
                            external_deletion: batch.external_deletion && operation_id.is_none(),
                            full_rescan,
                            operation_id,
                            paths: serialized,
                            revision,
                            snapshot,
                        },
                    );
                }
                Err(error) => {
                    let trace_id = format!(
                        "trace_{}",
                        &hash_text(&format!("scan:{}", unix_timestamp()))[..24]
                    );
                    eprintln!("Local library rescan error ({trace_id}): {error}");
                    let _ = event_app.emit(
                        "local-library-watch-error",
                        LocalLibraryWatchErrorEvent {
                            code: "local_library_rescan_failed".to_string(),
                            message: "无法刷新本地文献库，请重试。".to_string(),
                            trace_id,
                        },
                    );
                }
            }
        }
    });

    let mut active = state
        .watcher
        .lock()
        .map_err(|_| "本地文献库监听状态不可用。".to_string())?;
    *active = Some(watcher);
    Ok(())
}

pub fn start_local_library_watcher(app: AppHandle) {
    if let Err(error) = restart_local_library_watcher(&app) {
        let trace_id = format!(
            "trace_{}",
            &hash_text(&format!("watch-start:{}", unix_timestamp()))[..24]
        );
        eprintln!("Local library watcher is unavailable ({trace_id}): {error}");
        let _ = app.emit(
            "local-library-watch-error",
            LocalLibraryWatchErrorEvent {
                code: "local_library_watch_failed".to_string(),
                message: "本地文献库监听暂时不可用，请重试。".to_string(),
                trace_id,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_pdf_import_chunk, artifacts_directory, directory_contains_name, echo_paths_overlap,
        ensure_library_marker, ensure_relative_folder, export_library_backup_at_root,
        import_staging_directory, index_path, legacy_account_namespace, metadata_entries_directory,
        metadata_entry_path, metadata_only_entry_id, migrate_legacy_layout, non_empty,
        paper_artifact_directory_name, prepare_legacy_root_selection, prepare_library_migration,
        purge_expired_import_sessions_at, purge_expired_trash_at,
        purge_trash_items_with_index_writer, read_index, read_trash_manifest,
        record_committed_trash_operation, recover_trash_operations, resolve_import_directory,
        restore_legacy_library_marker, restore_trash_at_root, scan_local_library_paths,
        scan_local_library_root, stage_trash_operation, trash_directory, trash_operation_directory,
        trash_resource_at_root, trash_transaction_directory, unique_restore_target_with_case_rule,
        verified_tree_manifest, write_index, write_metadata_entry, write_trash_manifest,
        write_trash_operation_marker, LocalLibraryIndex, LocalLibraryWatchBatch,
        LocalLibraryWatchSignal, LocalTrashManifest, MetadataOnlyEntry, TrashOperationMarker,
        ARTIFACTS_DIRECTORY_NAME, INTERNAL_DIRECTORY_NAME, LEGACY_PROFILE_MARKER_FILE_NAME,
        LIBRARY_MARKER_FILE_NAME,
    };
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("liteasy-{name}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }

    fn initialized_library(name: &str) -> std::path::PathBuf {
        let root = temporary_directory(name);
        migrate_legacy_layout(&root).unwrap();
        ensure_library_marker(&root).unwrap();
        root
    }

    #[test]
    fn scans_only_readable_pdf_bodies() {
        let root = initialized_library("scan-supported-pdfs");
        fs::write(root.join("paper.PDF"), b"%PDF-1.7\nbody").unwrap();
        fs::write(root.join("fake.pdf"), b"not a pdf").unwrap();
        fs::write(root.join("notes.txt"), b"%PDF-1.7\nnot selected").unwrap();

        let snapshot = scan_local_library_root(&root).unwrap();
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].title, "paper");
        assert!(snapshot.entries[0].content_hash.is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_document_identity_across_an_external_rename() {
        let root = initialized_library("scan-external-rename");
        fs::write(root.join("before.pdf"), b"%PDF-1.7\nrename body").unwrap();
        let before = scan_local_library_root(&root).unwrap();
        fs::rename(root.join("before.pdf"), root.join("after.pdf")).unwrap();

        let after = scan_local_library_root(&root).unwrap();
        assert_eq!(after.entries[0].id, before.entries[0].id);
        assert_eq!(after.entries[0].title, "after");
        assert!(after.revision > before.revision);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rehashes_same_size_in_place_rewrites() {
        let root = initialized_library("scan-same-size-rewrite");
        let path = root.join("paper.pdf");
        fs::write(&path, b"%PDF-1.7\nAAAA").unwrap();
        let before = scan_local_library_root(&root).unwrap();
        fs::write(&path, b"%PDF-1.7\nBBBB").unwrap();

        let after = scan_local_library_root(&root).unwrap();
        assert_eq!(after.entries[0].id, before.entries[0].id);
        assert_ne!(
            after.entries[0].content_hash,
            before.entries[0].content_hash
        );
        assert!(after.revision > before.revision);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removes_legacy_account_marker_even_when_library_marker_exists() {
        let root = initialized_library("marker-account-migration");
        let marker_before = fs::read(root.join(LIBRARY_MARKER_FILE_NAME)).unwrap();
        fs::write(
            root.join(LEGACY_PROFILE_MARKER_FILE_NAME),
            b"legacy account",
        )
        .unwrap();

        ensure_library_marker(&root).unwrap();
        assert!(!root.join(LEGACY_PROFILE_MARKER_FILE_NAME).exists());
        assert_eq!(
            fs::read(root.join(LIBRARY_MARKER_FILE_NAME)).unwrap(),
            marker_before
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_a_legacy_root_before_the_caller_persists_its_selection() {
        let root = temporary_directory("legacy-root-selection");
        fs::write(root.join("paper.pdf"), b"%PDF-1.7\nbody").unwrap();
        fs::write(
            root.join(LEGACY_PROFILE_MARKER_FILE_NAME),
            b"legacy-account-namespace",
        )
        .unwrap();

        let (snapshot, legacy_marker) = prepare_legacy_root_selection(&root).unwrap();

        assert_eq!(snapshot.root_path, root.to_string_lossy());
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(
            legacy_marker.as_deref(),
            Some(b"legacy-account-namespace".as_slice())
        );
        assert!(!root.join(LEGACY_PROFILE_MARKER_FILE_NAME).exists());
        assert!(root.join(LIBRARY_MARKER_FILE_NAME).is_file());
        assert!(index_path(&root).is_file());

        restore_legacy_library_marker(&root, legacy_marker.as_deref()).unwrap();
        assert_eq!(
            fs::read(root.join(LEGACY_PROFILE_MARKER_FILE_NAME)).unwrap(),
            b"legacy-account-namespace"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_the_account_marker_when_legacy_root_validation_fails() {
        let root = temporary_directory("legacy-root-selection-failure");
        migrate_legacy_layout(&root).unwrap();
        fs::write(
            root.join(LEGACY_PROFILE_MARKER_FILE_NAME),
            b"legacy-account-namespace",
        )
        .unwrap();
        fs::write(index_path(&root), b"not-json").unwrap();

        let error = match prepare_legacy_root_selection(&root) {
            Ok(_) => panic!("corrupt legacy root must not be selected"),
            Err(error) => error,
        };

        assert!(error.contains("尚未切换当前库"));
        assert_eq!(
            fs::read(root.join(LEGACY_PROFILE_MARKER_FILE_NAME)).unwrap(),
            b"legacy-account-namespace"
        );
        assert_eq!(fs::read(index_path(&root)).unwrap(), b"not-json");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migrates_the_flat_v2_index_into_the_rebuildable_index_directory() {
        let root = temporary_directory("flat-v2-index-migration");
        let internal = root.join(".liteasy");
        fs::create_dir_all(&internal).unwrap();
        let legacy = internal.join("library-index.v2.json");
        let mut index = LocalLibraryIndex::default();
        index.revision = 9;
        fs::write(&legacy, serde_json::to_vec_pretty(&index).unwrap()).unwrap();

        migrate_legacy_layout(&root).unwrap();

        assert!(!legacy.exists());
        assert!(root.join(".liteasy/index/library-index.v2.json").is_file());
        assert_eq!(read_index(&root).unwrap().revision, 9);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn scanner_does_not_follow_symbolic_links() {
        use std::os::unix::fs::symlink;

        let root = initialized_library("scan-symlink-root");
        let outside = temporary_directory("scan-symlink-outside");
        fs::write(outside.join("outside.pdf"), b"%PDF-1.7\noutside").unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        let snapshot = scan_local_library_root(&root).unwrap();
        assert!(snapshot.entries.is_empty());
        assert!(snapshot.folders.is_empty());
        fs::remove_file(root.join("linked")).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn keeps_byte_identical_files_as_independent_logical_copies() {
        let root = initialized_library("identical-logical-copies");
        fs::write(root.join("first.pdf"), b"%PDF-1.7\nsame body").unwrap();
        fs::write(root.join("second.pdf"), b"%PDF-1.7\nsame body").unwrap();

        let snapshot = scan_local_library_root(&root).unwrap();
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(
            snapshot.entries[0].content_hash,
            snapshot.entries[1].content_hash
        );
        assert_ne!(snapshot.entries[0].id, snapshot.entries[1].id);
        fs::remove_dir_all(root).unwrap();
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
    fn retains_legacy_account_namespace_mapping_for_one_time_migration() {
        assert_ne!(
            legacy_account_namespace(Some("user:alice")),
            legacy_account_namespace(Some("user:bob"))
        );
        assert_eq!(
            legacy_account_namespace(None),
            legacy_account_namespace(Some("guest"))
        );
    }

    #[test]
    fn creates_zotero_relative_hierarchy_without_accepting_traversal() {
        let root = temporary_directory("zotero-hierarchy");
        let (target, created) =
            ensure_relative_folder(&root, Path::new("Collection/Transformers/2026")).unwrap();
        assert_eq!(created.len(), 3);
        assert_eq!(target, root.join("Collection/Transformers/2026"));
        assert!(target.is_dir());
        assert!(ensure_relative_folder(&root, Path::new("../outside")).is_err());
        assert!(!root.parent().unwrap().join("outside").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_zotero_hierarchy_through_a_symbolic_link() {
        use std::os::unix::fs::symlink;

        let root = temporary_directory("zotero-symlink-root");
        let outside = temporary_directory("zotero-symlink-outside");
        symlink(&outside, root.join("linked")).unwrap();
        assert!(ensure_relative_folder(&root, Path::new("linked/collection")).is_err());
        assert!(!outside.join("collection").exists());
        fs::remove_file(root.join("linked")).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn import_target_validation_never_creates_a_directory_outside_the_library() {
        let root = initialized_library("import-target-boundary");
        let outside_parent = temporary_directory("import-target-outside");
        let outside = outside_parent.join("must-not-be-created");

        assert!(
            resolve_import_directory(&root, Some(outside.to_string_lossy().to_string())).is_err()
        );
        assert!(!outside.exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside_parent).unwrap();
    }

    #[test]
    fn persists_metadata_entries_outside_the_rebuildable_index() {
        let root = initialized_library("metadata-entry-storage");
        let entry = MetadataOnlyEntry {
            doi: Some("10.1000/stored".to_string()),
            external_url: None,
            id: "entry-stored".to_string(),
            source_id: None,
            title: "Stored metadata".to_string(),
        };
        write_index(
            &root,
            &LocalLibraryIndex {
                entries: Vec::new(),
                metadata_only: vec![entry.clone()],
                revision: 1,
                ..LocalLibraryIndex::default()
            },
        )
        .unwrap();

        let migrated = read_index(&root).unwrap();
        assert_eq!(migrated.metadata_only, vec![entry.clone()]);
        assert!(metadata_entry_path(&root, &entry.id).unwrap().is_file());

        fs::remove_file(super::index_path(&root)).unwrap();
        let rebuilt = read_index(&root).unwrap();
        assert_eq!(rebuilt.metadata_only, vec![entry]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_to_rebuild_from_a_corrupt_metadata_entry() {
        let root = initialized_library("metadata-entry-corruption");
        fs::write(
            metadata_entries_directory(&root).join("entry-broken.json"),
            b"not json",
        )
        .unwrap();
        let error = read_index(&root).unwrap_err();
        assert!(error.contains("仅元数据条目损坏"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn applies_windows_case_insensitive_name_conflicts() {
        let root = temporary_directory("case-insensitive-conflict");
        fs::write(root.join("Paper.PDF"), b"%PDF-1.7\nbody").unwrap();
        assert!(directory_contains_name(&root, "paper.pdf", true).unwrap());
        assert!(!directory_contains_name(&root, "paper.pdf", false).unwrap());
        let restored = unique_restore_target_with_case_rule(&root.join("paper.pdf"), true).unwrap();
        assert_eq!(restored.file_name().unwrap(), "paper (2).pdf");
        fs::remove_dir_all(root).unwrap();
    }

    fn trash_manifest(trash_id: &str, purge_after: u64) -> LocalTrashManifest {
        LocalTrashManifest {
            artifact_references: Vec::new(),
            document_id: None,
            index_entries: Vec::new(),
            library_id: String::new(),
            metadata_entries: Vec::new(),
            node_type: "folder".to_string(),
            original_relative_path: "expired".to_string(),
            payload_relative_path: Some("payload".to_string()),
            purge_after,
            trash_id: trash_id.to_string(),
            trashed_at: 1,
        }
    }

    #[test]
    fn purges_only_expired_trash_entries() {
        let root = initialized_library("trash-expiry");
        let expired = trash_directory(&root).join("trash_expired");
        let active = trash_directory(&root).join("trash_active");
        fs::create_dir_all(&expired).unwrap();
        fs::create_dir_all(&active).unwrap();
        write_trash_manifest(&expired, &trash_manifest("trash_expired", 99)).unwrap();
        write_trash_manifest(&active, &trash_manifest("trash_active", 101)).unwrap();

        assert_eq!(purge_expired_trash_at(&root, 100).unwrap(), 1);
        assert!(!expired.exists());
        assert!(active.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_trash_manifest_blocks_expiry_cleanup() {
        let root = initialized_library("trash-corruption");
        let corrupt = trash_directory(&root).join("trash_corrupt");
        fs::create_dir_all(&corrupt).unwrap();
        fs::write(corrupt.join("manifest.json"), b"not json").unwrap();
        let error = purge_expired_trash_at(&root, 100).unwrap_err();
        assert!(error.contains("回收站清单损坏"));
        assert!(corrupt.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rolls_back_every_staged_trash_item_when_index_commit_fails() {
        let root = initialized_library("trash-purge-index-rollback");
        let first = trash_directory(&root).join("trash_first");
        let second = trash_directory(&root).join("trash_second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("payload.pdf"), b"%PDF-1.7\nfirst").unwrap();
        fs::write(second.join("payload.pdf"), b"%PDF-1.7\nsecond").unwrap();
        let revision = read_index(&root).unwrap().revision;

        let error =
            purge_trash_items_with_index_writer(&root, vec![first.clone(), second.clone()], |_| {
                Err("injected index failure".to_string())
            })
            .unwrap_err();

        assert!(error.contains("已回滚"));
        assert!(first.join("payload.pdf").is_file());
        assert!(second.join("payload.pdf").is_file());
        assert_eq!(read_index(&root).unwrap().revision, revision);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn commits_a_multi_item_trash_purge_with_one_revision() {
        let root = initialized_library("trash-purge-single-revision");
        let first = trash_directory(&root).join("trash_first");
        let second = trash_directory(&root).join("trash_second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let revision = read_index(&root).unwrap().revision;

        purge_trash_items_with_index_writer(&root, vec![first.clone(), second.clone()], |index| {
            write_index(&root, index)
        })
        .unwrap();

        assert!(!first.exists());
        assert!(!second.exists());
        assert_eq!(read_index(&root).unwrap().revision, revision + 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn merges_watcher_bursts_and_preserves_error_rescan_signals() {
        let root = temporary_directory("watch-batch");
        let first = root.join("paper.pdf");
        let second = root.join("folder");
        let mut batch = LocalLibraryWatchBatch::default();
        batch.merge(LocalLibraryWatchSignal::Change {
            external_deletion: false,
            paths: vec![first.clone(), second.clone()],
        });
        batch.merge(LocalLibraryWatchSignal::Change {
            external_deletion: true,
            paths: vec![first.clone()],
        });
        batch.merge(LocalLibraryWatchSignal::Error("overflow".to_string()));

        assert!(batch.external_deletion);
        assert_eq!(batch.normalized_paths(), vec![second, first]);
        assert_eq!(batch.watcher_errors, vec!["overflow"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn incrementally_rescans_only_affected_paths_and_preserves_renamed_identity() {
        let root = initialized_library("watch-incremental-rename");
        let before_path = root.join("before.pdf");
        let after_path = root.join("after.pdf");
        fs::write(&before_path, b"%PDF-1.7\nrename body").unwrap();
        fs::write(root.join("untouched.pdf"), b"%PDF-1.7\nuntouched").unwrap();
        let before = scan_local_library_root(&root).unwrap();
        let renamed_id = before
            .entries
            .iter()
            .find(|entry| entry.title == "before")
            .unwrap()
            .id
            .clone();
        let untouched_id = before
            .entries
            .iter()
            .find(|entry| entry.title == "untouched")
            .unwrap()
            .id
            .clone();
        fs::rename(&before_path, &after_path).unwrap();

        let after = scan_local_library_paths(&root, &[before_path, after_path]).unwrap();
        assert_eq!(
            after
                .entries
                .iter()
                .find(|entry| entry.title == "after")
                .unwrap()
                .id,
            renamed_id
        );
        assert_eq!(
            after
                .entries
                .iter()
                .find(|entry| entry.title == "untouched")
                .unwrap()
                .id,
            untouched_id
        );
        assert!(after.revision > before.revision);
        fs::remove_dir_all(root).unwrap();
    }

    fn prepare_interrupted_document_trash(
        root: &Path,
        trash_id: &str,
    ) -> (
        std::path::PathBuf,
        std::path::PathBuf,
        String,
        TrashOperationMarker,
    ) {
        let source = root.join("paper.pdf");
        fs::write(&source, b"%PDF-1.7\nbody").unwrap();
        scan_local_library_root(root).unwrap();
        let index = read_index(root).unwrap();
        let entry = index
            .entries
            .iter()
            .find(|entry| entry.relative_path == "paper.pdf")
            .unwrap()
            .clone();
        let artifact_name = paper_artifact_directory_name(&entry.id).unwrap();
        let artifact = artifacts_directory(root).join(&artifact_name);
        fs::create_dir_all(&artifact).unwrap();
        fs::write(artifact.join("annotations.v1.json"), b"[]").unwrap();
        let transaction = trash_transaction_directory(root, trash_id).unwrap();
        let manifest = LocalTrashManifest {
            artifact_references: vec![format!(
                "{INTERNAL_DIRECTORY_NAME}/paper-artifacts/{artifact_name}"
            )],
            document_id: Some(entry.id.clone()),
            index_entries: vec![entry.clone()],
            library_id: ensure_library_marker(root).unwrap().library_id,
            metadata_entries: Vec::new(),
            original_relative_path: "paper.pdf".to_string(),
            node_type: "document".to_string(),
            payload_relative_path: Some("payload".to_string()),
            purge_after: 100,
            trash_id: trash_id.to_string(),
            trashed_at: 1,
        };
        write_trash_manifest(&transaction, &manifest).unwrap();
        let transaction_id = transaction
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let marker = TrashOperationMarker {
            transaction_id,
            operation: "trash".to_string(),
            base_revision: index.revision,
            target_revision: index.revision + 1,
            trash_ids: vec![trash_id.to_string()],
            restore_target_relative: None,
            payload_relative_path: Some("payload".to_string()),
            artifact_names: vec![artifact_name.clone()],
            restored_document_ids: Vec::new(),
            restored_metadata_ids: Vec::new(),
            affected_document_ids: vec![entry.id],
            affected_metadata_ids: Vec::new(),
        };
        write_trash_operation_marker(&transaction, &marker).unwrap();
        fs::rename(&source, transaction.join("payload")).unwrap();
        fs::create_dir_all(transaction.join("artifacts")).unwrap();
        fs::rename(
            &artifact,
            transaction.join("artifacts").join(&artifact_name),
        )
        .unwrap();
        (transaction, source, artifact_name, marker)
    }

    #[test]
    fn rolls_back_an_uncommitted_document_trash_after_process_restart() {
        let root = initialized_library("trash-create-uncommitted-recovery");
        let (transaction, source, artifact_name, _marker) =
            prepare_interrupted_document_trash(&root, "trash_interrupted_uncommitted");

        recover_trash_operations(&root).unwrap();

        assert!(source.is_file());
        assert!(artifacts_directory(&root)
            .join(artifact_name)
            .join("annotations.v1.json")
            .is_file());
        assert!(!transaction.exists());
        assert!(!trash_directory(&root)
            .join("trash_interrupted_uncommitted")
            .exists());
        assert_eq!(read_index(&root).unwrap().entries.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preflights_every_trash_rollback_target_before_restoring_any_data() {
        let root = initialized_library("trash-create-rollback-preflight");
        let (transaction, source, first_artifact_name, mut marker) =
            prepare_interrupted_document_trash(&root, "trash_interrupted_conflict");
        let second_artifact_name = "second-artifact".to_string();
        let second_staged = transaction.join("artifacts").join(&second_artifact_name);
        fs::create_dir_all(&second_staged).unwrap();
        fs::write(second_staged.join("reader-state.json"), b"{}").unwrap();
        marker.artifact_names.push(second_artifact_name.clone());
        write_trash_operation_marker(&transaction, &marker).unwrap();
        let mut manifest = read_trash_manifest(&transaction.join("manifest.json")).unwrap();
        manifest.artifact_references.push(format!(
            "{INTERNAL_DIRECTORY_NAME}/{ARTIFACTS_DIRECTORY_NAME}/{second_artifact_name}"
        ));
        write_trash_manifest(&transaction, &manifest).unwrap();

        let conflicting_target = artifacts_directory(&root).join(&second_artifact_name);
        fs::create_dir_all(&conflicting_target).unwrap();
        fs::write(conflicting_target.join("unrelated.json"), b"{}").unwrap();

        let error = recover_trash_operations(&root).unwrap_err();

        assert!(error.contains("伴生数据冲突"));
        assert!(!source.exists());
        assert!(transaction.join("payload").is_file());
        assert!(transaction
            .join("artifacts")
            .join(&first_artifact_name)
            .is_dir());
        assert!(second_staged.is_dir());
        assert!(!artifacts_directory(&root)
            .join(&first_artifact_name)
            .exists());

        fs::remove_dir_all(&conflicting_target).unwrap();
        recover_trash_operations(&root).unwrap();
        assert!(source.is_file());
        assert!(artifacts_directory(&root)
            .join(first_artifact_name)
            .is_dir());
        assert!(artifacts_directory(&root)
            .join(second_artifact_name)
            .is_dir());
        assert!(!transaction.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn publishes_a_committed_document_trash_after_process_restart() {
        let root = initialized_library("trash-create-committed-recovery");
        let (transaction, source, artifact_name, marker) =
            prepare_interrupted_document_trash(&root, "trash_interrupted_committed");
        let mut index = read_index(&root).unwrap();
        index
            .entries
            .retain(|entry| !marker.affected_document_ids.contains(&entry.id));
        record_committed_trash_operation(&mut index, &marker.transaction_id);
        index.revision = marker.target_revision;
        write_index(&root, &index).unwrap();

        recover_trash_operations(&root).unwrap();

        let published = trash_directory(&root).join("trash_interrupted_committed");
        assert!(published.join("payload").is_file());
        assert!(published
            .join("artifacts")
            .join(artifact_name)
            .join("annotations.v1.json")
            .is_file());
        assert!(!published.join("operation.json").exists());
        assert!(!source.exists());
        assert!(!transaction.exists());
        assert!(read_index(&root).unwrap().entries.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_committed_marker_that_omits_its_manifest_document() {
        let root = initialized_library("trash-create-marker-mismatch");
        let (transaction, source, _artifact_name, mut marker) =
            prepare_interrupted_document_trash(&root, "trash_marker_mismatch");
        marker.affected_document_ids.clear();
        write_trash_operation_marker(&transaction, &marker).unwrap();
        let mut index = read_index(&root).unwrap();
        record_committed_trash_operation(&mut index, &marker.transaction_id);
        index.revision = marker.target_revision;
        write_index(&root, &index).unwrap();

        let error = recover_trash_operations(&root).unwrap_err();

        assert!(error.contains("受影响资源与清单不匹配"));
        assert!(!source.exists());
        assert!(transaction.join("payload").is_file());
        assert!(!trash_directory(&root)
            .join("trash_marker_mismatch")
            .exists());
        assert_eq!(read_index(&root).unwrap().entries.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_an_uncommitted_metadata_trash_after_process_restart() {
        let root = initialized_library("trash-metadata-uncommitted-recovery");
        let entry = MetadataOnlyEntry {
            doi: Some("10.1000/recovery".to_string()),
            external_url: None,
            id: "metadata-recovery".to_string(),
            source_id: None,
            title: ".liteasy".to_string(),
        };
        write_metadata_entry(&root, &entry).unwrap();
        let mut index = read_index(&root).unwrap();
        index.metadata_only.push(entry.clone());
        write_index(&root, &index).unwrap();
        let transaction = trash_transaction_directory(&root, "trash_metadata_interrupted").unwrap();
        write_trash_manifest(
            &transaction,
            &LocalTrashManifest {
                artifact_references: Vec::new(),
                document_id: Some(entry.id.clone()),
                index_entries: Vec::new(),
                library_id: ensure_library_marker(&root).unwrap().library_id,
                metadata_entries: vec![entry.clone()],
                original_relative_path: format!("仅元数据/{}", entry.title),
                node_type: "metadata_entry".to_string(),
                payload_relative_path: None,
                purge_after: 100,
                trash_id: "trash_metadata_interrupted".to_string(),
                trashed_at: 1,
            },
        )
        .unwrap();
        let marker = TrashOperationMarker {
            transaction_id: transaction
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            operation: "trash".to_string(),
            base_revision: index.revision,
            target_revision: index.revision + 1,
            trash_ids: vec!["trash_metadata_interrupted".to_string()],
            restore_target_relative: None,
            payload_relative_path: None,
            artifact_names: Vec::new(),
            restored_document_ids: Vec::new(),
            restored_metadata_ids: Vec::new(),
            affected_document_ids: Vec::new(),
            affected_metadata_ids: vec![entry.id.clone()],
        };
        write_trash_operation_marker(&transaction, &marker).unwrap();
        fs::rename(
            metadata_entry_path(&root, &entry.id).unwrap(),
            transaction.join("metadata-entry.json"),
        )
        .unwrap();

        recover_trash_operations(&root).unwrap();

        assert!(metadata_entry_path(&root, &entry.id).unwrap().is_file());
        assert!(!transaction.exists());
        assert!(read_index(&root)
            .unwrap()
            .metadata_only
            .iter()
            .any(|candidate| candidate.id == entry.id));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovers_a_prepared_purge_transaction_after_process_restart() {
        let root = initialized_library("trash-purge-crash-recovery");
        let trash_id = "trash_recover_purge";
        let trash_item = trash_directory(&root).join(trash_id);
        fs::create_dir_all(&trash_item).unwrap();
        fs::write(trash_item.join("payload.pdf"), b"%PDF-1.7\nbody").unwrap();
        let index = read_index(&root).unwrap();
        let transaction = trash_operation_directory(&root).join("purge_prepared_test");
        fs::create_dir_all(&transaction).unwrap();
        write_trash_operation_marker(
            &transaction,
            &TrashOperationMarker {
                transaction_id: "purge_prepared_test".to_string(),
                operation: "purge".to_string(),
                base_revision: index.revision,
                target_revision: index.revision + 1,
                trash_ids: vec![trash_id.to_string()],
                restore_target_relative: None,
                payload_relative_path: None,
                artifact_names: Vec::new(),
                restored_document_ids: Vec::new(),
                restored_metadata_ids: Vec::new(),
                affected_document_ids: Vec::new(),
                affected_metadata_ids: Vec::new(),
            },
        )
        .unwrap();
        fs::rename(&trash_item, transaction.join(trash_id)).unwrap();

        recover_trash_operations(&root).unwrap();
        assert!(trash_item.join("payload.pdf").is_file());
        assert!(!transaction.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preflights_every_purge_rollback_target_before_restoring_any_item() {
        let root = initialized_library("trash-purge-rollback-preflight");
        let trash_ids = ["trash_purge_first", "trash_purge_second"];
        for trash_id in trash_ids {
            let item = trash_directory(&root).join(trash_id);
            fs::create_dir_all(&item).unwrap();
            fs::write(item.join("payload.pdf"), b"%PDF-1.7\nbody").unwrap();
        }
        let index = read_index(&root).unwrap();
        let transaction = trash_operation_directory(&root).join("purge_preflight_test");
        fs::create_dir_all(&transaction).unwrap();
        write_trash_operation_marker(
            &transaction,
            &TrashOperationMarker {
                transaction_id: "purge_preflight_test".to_string(),
                operation: "purge".to_string(),
                base_revision: index.revision,
                target_revision: index.revision + 1,
                trash_ids: trash_ids.iter().map(|value| value.to_string()).collect(),
                restore_target_relative: None,
                payload_relative_path: None,
                artifact_names: Vec::new(),
                restored_document_ids: Vec::new(),
                restored_metadata_ids: Vec::new(),
                affected_document_ids: Vec::new(),
                affected_metadata_ids: Vec::new(),
            },
        )
        .unwrap();
        for trash_id in trash_ids {
            fs::rename(
                trash_directory(&root).join(trash_id),
                transaction.join(trash_id),
            )
            .unwrap();
        }
        let conflicting_target = trash_directory(&root).join(trash_ids[1]);
        fs::create_dir_all(&conflicting_target).unwrap();

        let error = recover_trash_operations(&root).unwrap_err();

        assert!(error.contains("永久删除事务与现有回收站条目冲突"));
        assert!(transaction.join(trash_ids[0]).is_dir());
        assert!(transaction.join(trash_ids[1]).is_dir());
        assert!(!trash_directory(&root).join(trash_ids[0]).exists());

        fs::remove_dir_all(conflicting_target).unwrap();
        recover_trash_operations(&root).unwrap();
        assert!(trash_directory(&root).join(trash_ids[0]).is_dir());
        assert!(trash_directory(&root).join(trash_ids[1]).is_dir());
        assert!(!transaction.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovers_a_restore_that_moved_the_body_before_the_index_commit() {
        let root = initialized_library("trash-restore-crash-recovery");
        let source = root.join("paper.pdf");
        fs::write(&source, b"%PDF-1.7\nbody").unwrap();
        let before = scan_local_library_root(&root).unwrap();
        trash_resource_at_root(&root, &source.to_string_lossy()).unwrap();
        let trash_item = fs::read_dir(trash_directory(&root))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let manifest = read_trash_manifest(&trash_item.join("manifest.json")).unwrap();
        let index = read_index(&root).unwrap();
        let transaction = stage_trash_operation(&root, &trash_item, "restore").unwrap();
        write_trash_operation_marker(
            &transaction,
            &TrashOperationMarker {
                transaction_id: transaction
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                operation: "restore".to_string(),
                base_revision: index.revision,
                target_revision: index.revision + 1,
                trash_ids: vec![manifest.trash_id.clone()],
                restore_target_relative: Some("paper.pdf".to_string()),
                payload_relative_path: Some("payload".to_string()),
                artifact_names: Vec::new(),
                restored_document_ids: manifest
                    .index_entries
                    .iter()
                    .map(|entry| entry.id.clone())
                    .collect(),
                restored_metadata_ids: Vec::new(),
                affected_document_ids: Vec::new(),
                affected_metadata_ids: Vec::new(),
            },
        )
        .unwrap();
        fs::rename(transaction.join("payload"), &source).unwrap();

        recover_trash_operations(&root).unwrap();
        assert!(!source.exists());
        assert!(trash_directory(&root)
            .join(manifest.trash_id)
            .join("payload")
            .is_file());
        assert_eq!(read_index(&root).unwrap().revision, before.revision + 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preflights_restore_destination_before_moving_the_active_body() {
        let root = initialized_library("trash-restore-destination-preflight");
        let source = root.join("paper.pdf");
        fs::write(&source, b"%PDF-1.7\nbody").unwrap();
        scan_local_library_root(&root).unwrap();
        trash_resource_at_root(&root, &source.to_string_lossy()).unwrap();
        let trash_item = fs::read_dir(trash_directory(&root))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let manifest = read_trash_manifest(&trash_item.join("manifest.json")).unwrap();
        let index = read_index(&root).unwrap();
        let transaction = stage_trash_operation(&root, &trash_item, "restore").unwrap();
        write_trash_operation_marker(
            &transaction,
            &TrashOperationMarker {
                transaction_id: transaction
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                operation: "restore".to_string(),
                base_revision: index.revision,
                target_revision: index.revision + 1,
                trash_ids: vec![manifest.trash_id.clone()],
                restore_target_relative: Some("paper.pdf".to_string()),
                payload_relative_path: Some("payload".to_string()),
                artifact_names: Vec::new(),
                restored_document_ids: manifest
                    .index_entries
                    .iter()
                    .map(|entry| entry.id.clone())
                    .collect(),
                restored_metadata_ids: Vec::new(),
                affected_document_ids: Vec::new(),
                affected_metadata_ids: Vec::new(),
            },
        )
        .unwrap();
        fs::rename(transaction.join("payload"), &source).unwrap();
        let conflicting_destination = trash_directory(&root).join(&manifest.trash_id);
        fs::create_dir_all(&conflicting_destination).unwrap();

        let error = recover_trash_operations(&root).unwrap_err();

        assert!(error.contains("回收站恢复事务与现有条目冲突"));
        assert!(source.is_file());
        assert!(!transaction.join("payload").exists());
        assert!(transaction.join("operation.json").is_file());

        fs::remove_dir_all(&conflicting_destination).unwrap();
        recover_trash_operations(&root).unwrap();
        assert!(!source.exists());
        assert!(trash_directory(&root)
            .join(manifest.trash_id)
            .join("payload")
            .is_file());
        assert!(!transaction.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn matches_operation_echoes_for_nodes_and_their_descendants() {
        assert!(echo_paths_overlap(
            "/library/folder",
            "/library/folder/paper.pdf"
        ));
        assert!(echo_paths_overlap(
            "/library/folder/paper.pdf",
            "/library/folder"
        ));
        assert!(!echo_paths_overlap(
            "/library/folder-a",
            "/library/folder-b"
        ));
    }

    #[test]
    fn prepares_a_byte_verified_library_root_migration() {
        let source = initialized_library("migration-source");
        let target = temporary_directory("migration-target");
        fs::create_dir_all(source.join("topic")).unwrap();
        fs::write(source.join("topic/paper.pdf"), b"%PDF-1.7\nbody").unwrap();

        prepare_library_migration(&source, &target).unwrap();
        assert_eq!(
            verified_tree_manifest(&source).unwrap(),
            verified_tree_manifest(&target).unwrap()
        );
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn exports_a_complete_byte_verified_library_backup_without_changing_the_source() {
        let source = initialized_library("backup-source");
        let destination_parent = temporary_directory("backup-parent");
        fs::create_dir_all(source.join("topic")).unwrap();
        fs::write(source.join("topic/paper.pdf"), b"%PDF-1.7\nbody").unwrap();
        fs::write(
            source
                .join(INTERNAL_DIRECTORY_NAME)
                .join("paper-artifacts/note.json"),
            br#"{"note":"kept"}"#,
        )
        .unwrap();

        let backup = export_library_backup_at_root(&source, &destination_parent).unwrap();

        assert!(source.join("topic/paper.pdf").is_file());
        assert_eq!(
            verified_tree_manifest(&source).unwrap(),
            verified_tree_manifest(&backup).unwrap()
        );
        assert_eq!(
            fs::read(
                backup
                    .join(INTERNAL_DIRECTORY_NAME)
                    .join("paper-artifacts/note.json")
            )
            .unwrap(),
            br#"{"note":"kept"}"#
        );
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(destination_parent).unwrap();
    }

    #[test]
    fn rejects_a_backup_destination_inside_the_active_library() {
        let source = initialized_library("backup-inside-source");
        let destination_parent = source.join("backups");
        fs::create_dir_all(&destination_parent).unwrap();

        let error = export_library_backup_at_root(&source, &destination_parent).unwrap_err();

        assert!(error.contains("不能位于当前文献库内部"));
        assert_eq!(fs::read_dir(&destination_parent).unwrap().count(), 0);
        fs::remove_dir_all(source).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn failed_library_root_migration_cleans_the_target_and_keeps_source() {
        use std::os::unix::fs::symlink;

        let source = initialized_library("migration-failure-source");
        let target = temporary_directory("migration-failure-target");
        let outside = temporary_directory("migration-failure-outside");
        fs::write(source.join("paper.pdf"), b"%PDF-1.7\nbody").unwrap();
        symlink(&outside, source.join("linked")).unwrap();

        assert!(prepare_library_migration(&source, &target).is_err());
        assert!(source.join("paper.pdf").is_file());
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
        fs::remove_file(source.join("linked")).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(target).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn appends_pdf_imports_in_bounded_chunks() {
        let root = initialized_library("streamed-import");
        let session = import_staging_directory(&root).join("import_valid");
        fs::create_dir_all(&session).unwrap();
        fs::write(session.join("payload.part"), []).unwrap();

        append_pdf_import_chunk(&root, "import_valid", b"%PDF-").unwrap();
        append_pdf_import_chunk(&root, "import_valid", b"1.7\nbody").unwrap();
        assert_eq!(
            fs::read(session.join("payload.part")).unwrap(),
            b"%PDF-1.7\nbody"
        );
        assert!(append_pdf_import_chunk(&root, "import_valid", &[]).is_err());
        assert!(append_pdf_import_chunk(&root, "import_valid", &vec![0; 1024 * 1024 + 1]).is_err());
        assert!(append_pdf_import_chunk(&root, "../escape", b"data").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_absolute_parent_paths_for_nested_library_folders() {
        let root = initialized_library("nested-folder-snapshot");
        let parent = root.join("Parent");
        fs::create_dir_all(parent.join("Child")).unwrap();

        let snapshot = scan_local_library_root(&root).unwrap();
        let child = snapshot
            .folders
            .iter()
            .find(|folder| folder.name == "Child")
            .unwrap();

        assert_eq!(child.parent_path.as_deref(), parent.to_str());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn purges_only_expired_pdf_import_sessions() {
        let root = initialized_library("import-staging-expiry");
        let staging = import_staging_directory(&root);
        let expired = staging.join("import_expired");
        let active = staging.join("import_active");
        fs::create_dir_all(&expired).unwrap();
        fs::create_dir_all(&active).unwrap();
        fs::write(
            expired.join("manifest.json"),
            br#"{"createdAt":1,"name":"old.pdf","targetDirectoryRelative":""}"#,
        )
        .unwrap();
        fs::write(
            active.join("manifest.json"),
            br#"{"createdAt":86401,"name":"new.pdf","targetDirectoryRelative":""}"#,
        )
        .unwrap();

        assert_eq!(purge_expired_import_sessions_at(&root, 86402).unwrap(), 1);
        assert!(!expired.exists());
        assert!(active.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trashes_and_restores_a_complete_folder_without_overwriting_a_conflict() {
        let root = initialized_library("folder-trash-transaction");
        fs::create_dir_all(root.join("Research/Subtopic")).unwrap();
        fs::write(root.join("Research/one.pdf"), b"%PDF-1.7\none").unwrap();
        fs::write(root.join("Research/Subtopic/two.pdf"), b"%PDF-1.7\ntwo").unwrap();
        let before = scan_local_library_root(&root).unwrap();
        let ids = before
            .entries
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<HashSet<_>>();

        trash_resource_at_root(&root, &root.join("Research").to_string_lossy()).unwrap();
        assert!(!root.join("Research").exists());
        let trashed = super::list_trash_entries(&root).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].document_count, 2);

        fs::create_dir_all(root.join("Research")).unwrap();
        fs::write(root.join("Research/existing.pdf"), b"%PDF-1.7\nexisting").unwrap();
        let restored = restore_trash_at_root(&root, &trashed[0].trash_id)
            .unwrap()
            .unwrap();
        assert_eq!(restored.file_name().unwrap(), "Research (2)");
        assert!(root.join("Research/existing.pdf").is_file());
        assert!(root.join("Research (2)/one.pdf").is_file());
        assert!(root.join("Research (2)/Subtopic/two.pdf").is_file());
        let after = scan_local_library_root(&root).unwrap();
        let restored_ids = after
            .entries
            .iter()
            .filter(|entry| {
                entry
                    .relative_path
                    .as_deref()
                    .is_some_and(|path| path.starts_with("Research (2)/"))
            })
            .map(|entry| entry.id.clone())
            .collect::<HashSet<_>>();
        assert_eq!(restored_ids, ids);
        fs::remove_dir_all(root).unwrap();
    }
}
