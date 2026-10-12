use base64::Engine;
use chrono::{SecondsFormat, Utc};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const EXPORT_HISTORY_VERSION: &str = "liteasy.artifact-export-history/v2";
const LEGACY_EXPORT_HISTORY_VERSION: &str = "liteasy.artifact-export-history/v1";
const MAX_EXPORT_HISTORY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ARTIFACT_ID_CHARS: usize = 256;
const MAX_FILE_NAME_CHARS: usize = 255;
const MAX_TITLE_CHARS: usize = 512;
static EXPORT_HISTORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactExportFormat {
    Html,
    Markdown,
    Pdf,
    Docx,
    Unknown,
}

impl ArtifactExportFormat {
    fn extension(&self) -> &'static str {
        match self {
            Self::Html => "html",
            Self::Markdown => "md",
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Unknown => "unknown",
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Self::Html => "HTML",
            Self::Markdown => "Markdown",
            Self::Pdf => "PDF",
            Self::Docx => "Word",
            Self::Unknown => "Unsupported",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactExportStatus {
    Available,
    Missing,
    Unsupported,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactExportRecord {
    artifact_id: String,
    exported_at: String,
    file_name: String,
    format: ArtifactExportFormat,
    id: String,
    location: String,
    path: PathBuf,
    status: ArtifactExportStatus,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original_format: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactExportInput {
    artifact_id: String,
    content: String,
    content_encoding: ArtifactContentEncoding,
    file_name: String,
    pub(crate) format: ArtifactExportFormat,
    title: String,
    #[serde(default)]
    container: Option<String>,
    #[serde(default)]
    receipt: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) protected_paths: Vec<PathBuf>,
    #[serde(default)]
    scope_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ArtifactContentEncoding {
    Base64,
    Utf8,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ArtifactExportOutcome {
    Cancelled,
    Saved {
        record: ArtifactExportRecord,
        warnings: Vec<String>,
    },
}

#[derive(Deserialize, Serialize)]
struct ArtifactExportSnapshot {
    records: Vec<serde_json::Value>,
    version: String,
}

fn snapshot(records: Vec<ArtifactExportRecord>) -> ArtifactExportSnapshot {
    ArtifactExportSnapshot {
        records: records
            .into_iter()
            .map(|record| serde_json::to_value(record).expect("serializable export record"))
            .collect(),
        version: EXPORT_HISTORY_VERSION.to_string(),
    }
}

fn history_path_at(app_data: &Path) -> PathBuf {
    app_data.join("artifact-exports").join("history.v2.json")
}

fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::data_location::root(&app).map_err(|error| format!("无法定位导出历史目录：{error}"))
}

fn timestamp_nonce() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn quarantine_corrupt_snapshot(path: &Path, reason: impl std::fmt::Display) -> String {
    let quarantined = path.with_file_name(format!(
        "{}.corrupt-{}-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("history"),
        std::process::id(),
        timestamp_nonce()
    ));
    match fs::rename(path, &quarantined) {
        Ok(()) => format!(
            "导出历史已损坏，已隔离到 {}：{reason}",
            quarantined.display()
        ),
        Err(error) => format!("导出历史已损坏且无法隔离：{reason}；{error}"),
    }
}

fn read_snapshot_at(app_data: &Path) -> Result<ArtifactExportSnapshot, String> {
    let current = history_path_at(app_data);
    let legacy = app_data.join("artifact-exports").join("history.v1.json");
    let path = if current.exists() { current } else { legacy };
    if !path.exists() {
        return Ok(snapshot(Vec::new()));
    }
    let metadata = fs::metadata(&path).map_err(|error| format!("无法检查导出历史：{error}"))?;
    if metadata.len() > MAX_EXPORT_HISTORY_BYTES {
        return Err(quarantine_corrupt_snapshot(
            &path,
            format!("快照超过 {MAX_EXPORT_HISTORY_BYTES} 字节限制"),
        ));
    }
    let serialized = fs::read(&path).map_err(|error| format!("无法读取导出历史：{error}"))?;
    let mut parsed: ArtifactExportSnapshot = serde_json::from_slice(&serialized)
        .map_err(|error| quarantine_corrupt_snapshot(&path, error))?;
    if parsed.version == LEGACY_EXPORT_HISTORY_VERSION {
        // Explicit v1 -> v2 migration in memory. The original v1 file is never overwritten.
        parsed.version = EXPORT_HISTORY_VERSION.into();
    } else if parsed.version != EXPORT_HISTORY_VERSION {
        return Err(format!(
            "不支持的导出历史版本 {}；原始记录保持只读且未改写。",
            parsed.version
        ));
    }
    Ok(parsed)
}

#[cfg(not(windows))]
fn publish_snapshot(temporary_path: &Path, path: &Path) -> Result<(), String> {
    fs::rename(temporary_path, path).map_err(|error| format!("无法发布文件：{error}"))
}

#[cfg(windows)]
fn publish_snapshot(temporary_path: &Path, path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temporary: Vec<u16> = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(format!("无法发布文件：{}", std::io::Error::last_os_error()));
    }
    Ok(())
}

fn save_snapshot_with_publisher_at<F>(
    app_data: &Path,
    snapshot: &ArtifactExportSnapshot,
    publish: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> Result<(), String>,
{
    let serialized =
        serde_json::to_vec(snapshot).map_err(|error| format!("无法编码导出历史：{error}"))?;
    if serialized.len() as u64 > MAX_EXPORT_HISTORY_BYTES {
        return Err(format!("导出历史超过 {MAX_EXPORT_HISTORY_BYTES} 字节限制"));
    }
    let path = history_path_at(app_data);
    let parent = path
        .parent()
        .ok_or_else(|| "导出历史路径缺少父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建导出历史目录：{error}"))?;
    let temporary_path = parent.join(format!(
        ".history.v2.{}.{}.tmp",
        std::process::id(),
        timestamp_nonce()
    ));
    let result = (|| -> Result<(), String> {
        let mut temporary = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| format!("无法创建临时导出历史：{error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("无法保护临时导出历史：{error}"))?;
        }
        temporary
            .write_all(&serialized)
            .and_then(|_| temporary.sync_all())
            .map_err(|error| format!("无法写入导出历史：{error}"))?;
        publish(&temporary_path, &path)?;
        Ok(())
    })();
    if result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

fn save_snapshot_at(app_data: &Path, snapshot: &ArtifactExportSnapshot) -> Result<(), String> {
    save_snapshot_with_publisher_at(app_data, snapshot, publish_snapshot)
}

fn list_records_at(app_data: &Path) -> Result<Vec<ArtifactExportRecord>, String> {
    let mut history = read_snapshot_at(app_data)?;
    let mut changed = false;
    let mut readable = Vec::new();
    for raw in &mut history.records {
        // Future/unknown formats remain opaque in the v1 snapshot; one item cannot erase history.
        let parsed = serde_json::from_value::<ArtifactExportRecord>(raw.clone());
        if parsed.as_ref().map_or(true, |record| {
            record.format == ArtifactExportFormat::Unknown
        }) {
            if let (Some(id), Some(format)) = (raw["id"].as_str(), raw["format"].as_str()) {
                readable.push(ArtifactExportRecord {
                    id: id.into(),
                    format: ArtifactExportFormat::Unknown,
                    original_format: Some(format.into()),
                    artifact_id: raw["artifactId"].as_str().unwrap_or("").into(),
                    exported_at: raw["exportedAt"].as_str().unwrap_or("").into(),
                    file_name: raw["fileName"].as_str().unwrap_or("未知格式记录").into(),
                    title: raw["title"].as_str().unwrap_or("未支持的历史格式").into(),
                    location: "desktop".into(),
                    path: PathBuf::from(raw["path"].as_str().unwrap_or("")),
                    status: ArtifactExportStatus::Unsupported,
                    receipt: None,
                });
            }
            continue;
        }
        let mut record = parsed.expect("validated readable record");
        let next_status = if record.path.is_file() {
            ArtifactExportStatus::Available
        } else {
            ArtifactExportStatus::Missing
        };
        if record.status != next_status {
            record.status = next_status;
            raw["status"] = serde_json::to_value(&record.status).map_err(|e| e.to_string())?;
            changed = true;
        }
        readable.push(record);
    }
    readable.sort_by(|left, right| right.exported_at.cmp(&left.exported_at));
    if changed {
        save_snapshot_at(app_data, &history)?;
    }
    Ok(readable)
}

fn remove_record_at(app_data: &Path, record_id: &str) -> Result<(), String> {
    let mut history = read_snapshot_at(app_data)?;
    history
        .records
        .retain(|record| record["id"].as_str() != Some(record_id));
    save_snapshot_at(app_data, &history)
}

fn saved_file_history_error(path: &Path, error: impl std::fmt::Display) -> String {
    format!("文件已保存，但未写入导出历史：{}；{error}", path.display())
}

fn persist_record_after_file_save_at(
    app_data: &Path,
    record: ArtifactExportRecord,
) -> Result<(), String> {
    let saved_path = record.path.clone();
    let result = (|| -> Result<(), String> {
        let _guard = EXPORT_HISTORY_LOCK
            .lock()
            .map_err(|_| "导出历史锁不可用。".to_string())?;
        let mut history = read_snapshot_at(app_data)?;
        history
            .records
            .push(serde_json::to_value(record).map_err(|e| e.to_string())?);
        save_snapshot_at(app_data, &history)
    })();
    result.map_err(|error| saved_file_history_error(&saved_path, error))
}

fn find_available_record_at(
    app_data: &Path,
    record_id: &str,
) -> Result<ArtifactExportRecord, String> {
    let record = list_records_at(app_data)?
        .into_iter()
        .find(|record| record.id == record_id)
        .ok_or_else(|| "找不到导出记录。".to_string())?;
    if record.status == ArtifactExportStatus::Unsupported {
        return Err("此历史格式未受支持，记录保持只读。".into());
    }
    if record.status == ArtifactExportStatus::Missing {
        return Err("导出文件已不存在。".to_string());
    }
    Ok(record)
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn safe_suggested_file_name(input: &ArtifactExportInput) -> String {
    let requested = Path::new(&input.file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Liteasy-artifact");
    let sanitized: String = requested
        .chars()
        .map(|character| match character {
            '\0'..='\u{1f}' | '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => character,
        })
        .collect();
    let stem = truncate(
        sanitized.trim_end_matches(['.', ' ']),
        MAX_FILE_NAME_CHARS.saturating_sub(5),
    );
    let stem = if stem.trim().is_empty() {
        "Liteasy-artifact"
    } else {
        stem.trim()
    };
    let lower = stem.to_ascii_lowercase();
    let reserved = ["con", "prn", "aux", "nul"].contains(&lower.split('.').next().unwrap_or(""))
        || (lower.starts_with("com") || lower.starts_with("lpt"))
            && lower
                .as_bytes()
                .get(3)
                .is_some_and(|c| (b'1'..=b'9').contains(c));
    format!(
        "{}{stem}.{}",
        if reserved { "Liteasy-" } else { "" },
        output_extension(input)
    )
}

fn output_extension(input: &ArtifactExportInput) -> &'static str {
    if input.format == ArtifactExportFormat::Markdown && input.container.as_deref() == Some("zip") {
        "zip"
    } else {
        input.format.extension()
    }
}
fn validate_export_content(input: &ArtifactExportInput, content: &[u8]) -> Result<(), String> {
    if input.format == ArtifactExportFormat::Unknown {
        return Err("未支持的导出格式。".into());
    }
    if content.is_empty() || content.len() > 64 * 1024 * 1024 {
        return Err("导出内容为空或超过 64 MiB。".into());
    }
    if input.container.is_some()
        && (input.container.as_deref() != Some("zip")
            || input.format != ArtifactExportFormat::Markdown)
    {
        return Err("导出容器与格式不匹配。".into());
    }
    if input.format == ArtifactExportFormat::Pdf
        && (!content.starts_with(b"%PDF-")
            || !content
                .windows(5)
                .rev()
                .take(1024)
                .any(|part| part == b"%%EOF"))
    {
        return Err("PDF 产物无效。".into());
    }
    if (input.format == ArtifactExportFormat::Docx || input.container.is_some())
        && !content.starts_with(b"PK\x03\x04")
    {
        return Err("文档压缩包无效。".into());
    }
    if let Some(receipt) = &input.receipt {
        use sha2::{Digest, Sha256};
        let digest = format!("{:x}", Sha256::digest(content));
        if receipt["sha256"].as_str() != Some(&digest)
            || receipt["byteLength"].as_u64() != Some(content.len() as u64)
        {
            return Err("导出字节与核验回执不一致。".into());
        }
    }
    Ok(())
}
fn publish_export_with<F>(
    path: &Path,
    content: &[u8],
    protected_paths: &[PathBuf],
    publish: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> Result<(), String>,
{
    if path.is_symlink() {
        return Err("不能覆盖符号链接目标。".into());
    }
    for source in protected_paths {
        if path == source
            || (path.exists()
                && source.exists()
                && fs::canonicalize(path).ok() == fs::canonicalize(source).ok())
        {
            return Err("不能覆盖当前来源文件，请另选导出位置。".into());
        }
        #[cfg(windows)]
        if let (Ok(target), Ok(original)) = (std::fs::File::open(path), std::fs::File::open(source))
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            };
            let mut a: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            let mut b: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            let same = unsafe {
                GetFileInformationByHandle(target.as_raw_handle(), &mut a) != 0
                    && GetFileInformationByHandle(original.as_raw_handle(), &mut b) != 0
            } && a.dwVolumeSerialNumber == b.dwVolumeSerialNumber
                && a.nFileIndexHigh == b.nFileIndexHigh
                && a.nFileIndexLow == b.nFileIndexLow;
            if same {
                return Err("不能覆盖当前来源文件。".into());
            }
        }
        #[cfg(unix)]
        if let (Ok(target), Ok(original)) = (fs::metadata(path), fs::metadata(source)) {
            use std::os::unix::fs::MetadataExt;
            if target.dev() == original.dev() && target.ino() == original.ino() {
                return Err("不能覆盖当前来源文件。".into());
            }
        }
    }
    let parent = path.parent().ok_or("导出目标缺少目录。")?;
    let temporary_path = parent.join(format!(
        ".liteasy-export-{}-{}.tmp",
        std::process::id(),
        timestamp_nonce()
    ));
    let result = (|| {
        let mut temporary = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|e| format!("无法创建临时导出：{e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        temporary
            .write_all(content)
            .and_then(|_| temporary.sync_all())
            .map_err(|e| format!("无法完整写入导出：{e}"))?;
        drop(temporary);
        publish(&temporary_path, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

fn decode_content(input: &ArtifactExportInput) -> Result<Vec<u8>, String> {
    match input.content_encoding {
        ArtifactContentEncoding::Utf8 => Ok(input.content.as_bytes().to_vec()),
        ArtifactContentEncoding::Base64 => base64::engine::general_purpose::STANDARD
            .decode(&input.content)
            .map_err(|error| format!("无法解码导出内容：{error}")),
    }
}

fn spawn_open(record: &ArtifactExportRecord) -> Result<(), String> {
    let mut command = if cfg!(target_os = "windows") {
        Command::new("explorer")
    } else if cfg!(target_os = "macos") {
        Command::new("open")
    } else {
        Command::new("xdg-open")
    };
    command
        .arg(&record.path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开导出文件：{error}"))
}

fn spawn_reveal(record: &ArtifactExportRecord) -> Result<(), String> {
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(format!("/select,{}", record.path.display()));
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg("-R").arg(&record.path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(record.path.parent().unwrap_or(Path::new("/")));
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法在文件管理器中显示导出文件：{error}"))
}

#[tauri::command]
pub fn export_artifact_document(
    app: AppHandle,
    input: ArtifactExportInput,
) -> Result<ArtifactExportOutcome, String> {
    let content = decode_content(&input)?;
    validate_export_content(&input, &content)?;
    let suggested_name = safe_suggested_file_name(&input);
    let selected = FileDialog::new()
        .add_filter(input.format.label(), &[output_extension(&input)])
        .set_file_name(&suggested_name)
        .save_file();
    let Some(selected) = selected else {
        return Ok(ArtifactExportOutcome::Cancelled);
    };
    save_export_at(app, input, selected)
}

pub(crate) fn save_export_at(
    app: AppHandle,
    input: ArtifactExportInput,
    selected: PathBuf,
) -> Result<ArtifactExportOutcome, String> {
    let content = decode_content(&input)?;
    validate_export_content(&input, &content)?;
    let suggested_name = safe_suggested_file_name(&input);
    if !selected
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(output_extension(&input)))
    {
        return Err(format!(
            "输出扩展名应为 .{}，请重新选择准确的保存位置。",
            output_extension(&input)
        ));
    }
    if let Some(scope) = &input.scope_id {
        if &crate::desktop_identity::local_object_scope()? != scope {
            return Err("账号已切换，未发布导出文件。".into());
        }
    }
    publish_export_with(
        &selected,
        &content,
        &input.protected_paths,
        publish_snapshot,
    )?;
    let absolute_path = fs::canonicalize(&selected).unwrap_or(selected);
    let exported_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let record = ArtifactExportRecord {
        artifact_id: truncate(&input.artifact_id, MAX_ARTIFACT_ID_CHARS),
        exported_at,
        file_name: absolute_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| truncate(value, MAX_FILE_NAME_CHARS))
            .unwrap_or(suggested_name),
        format: input.format,
        id: format!("export-{}-{}", std::process::id(), timestamp_nonce()),
        location: "desktop".to_string(),
        path: absolute_path.clone(),
        status: ArtifactExportStatus::Available,
        title: truncate(&input.title, MAX_TITLE_CHARS),
        receipt: input.receipt,
        original_format: None,
    };
    let history = history_root(&app)
        .and_then(|root| persist_record_after_file_save_at(&root, record.clone()));
    let warnings = if history.is_err() {
        vec!["history_write_failed".to_string()]
    } else {
        vec![]
    };
    Ok(ArtifactExportOutcome::Saved { record, warnings })
}

#[tauri::command]
pub fn list_artifact_exports(app: AppHandle) -> Result<Vec<ArtifactExportRecord>, String> {
    let _guard = EXPORT_HISTORY_LOCK
        .lock()
        .map_err(|_| "导出历史锁不可用。".to_string())?;
    list_records_at(&history_root(&app)?)
}

#[tauri::command]
pub fn open_artifact_export(
    app: AppHandle,
    record_id: String,
) -> Result<ArtifactExportRecord, String> {
    let _guard = EXPORT_HISTORY_LOCK
        .lock()
        .map_err(|_| "导出历史锁不可用。".to_string())?;
    let record = find_available_record_at(&history_root(&app)?, &record_id)?;
    spawn_open(&record)?;
    Ok(record)
}

#[tauri::command]
pub fn reveal_artifact_export(
    app: AppHandle,
    record_id: String,
) -> Result<ArtifactExportRecord, String> {
    let _guard = EXPORT_HISTORY_LOCK
        .lock()
        .map_err(|_| "导出历史锁不可用。".to_string())?;
    let record = find_available_record_at(&history_root(&app)?, &record_id)?;
    spawn_reveal(&record)?;
    Ok(record)
}

#[tauri::command]
pub fn remove_artifact_export(app: AppHandle, record_id: String) -> Result<(), String> {
    let _guard = EXPORT_HISTORY_LOCK
        .lock()
        .map_err(|_| "导出历史锁不可用。".to_string())?;
    remove_record_at(&history_root(&app)?, &record_id)
}

#[cfg(test)]
mod tests {
    use super::{
        find_available_record_at, list_records_at, persist_record_after_file_save_at,
        publish_export_with, publish_snapshot, read_snapshot_at, remove_record_at,
        save_snapshot_at, save_snapshot_with_publisher_at, snapshot, ArtifactExportFormat,
        ArtifactExportRecord, ArtifactExportStatus,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "liteasy-artifact-exports-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temporary directory");
        path
    }

    fn record(root: &Path, id: &str, exported_at: &str) -> ArtifactExportRecord {
        ArtifactExportRecord {
            artifact_id: format!("artifact-{id}"),
            exported_at: exported_at.to_string(),
            file_name: format!("{id}.md"),
            format: ArtifactExportFormat::Markdown,
            id: id.to_string(),
            location: "desktop".to_string(),
            path: root.join(format!("{id}.md")),
            status: ArtifactExportStatus::Available,
            title: id.to_string(),
            receipt: None,
            original_format: None,
        }
    }

    #[test]
    fn failed_output_publish_keeps_existing_target_and_cleans_temporary_file() {
        let root = temporary_directory("publish-output");
        let target = root.join("existing.md");
        fs::write(&target, b"old source").unwrap();
        let error = publish_export_with(&target, b"replacement", &[], |_, _| {
            Err("injected publish failure".into())
        })
        .unwrap_err();
        assert!(error.contains("injected"));
        assert_eq!(fs::read(&target).unwrap(), b"old source");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        publish_export_with(&target, b"replacement", &[], publish_snapshot).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"replacement");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_source_overwrite_and_preserves_opaque_future_history() {
        let root = temporary_directory("source-protection");
        let target = root.join("source.md");
        fs::write(&target, b"source").unwrap();
        assert!(
            publish_export_with(&target, b"replacement", &[target.clone()], publish_snapshot)
                .is_err()
        );
        let known = record(&root, "known", "2026-10-12");
        let mut history = snapshot(vec![known]);
        let future =
            serde_json::json!({"id":"future", "format":"future-format", "opaque":{"keep":true}});
        history.records.push(future.clone());
        save_snapshot_at(&root, &history).unwrap();
        assert_eq!(list_records_at(&root).unwrap().len(), 2);
        remove_record_at(&root, "known").unwrap();
        assert!(read_snapshot_at(&root).unwrap().records.contains(&future));
        assert_eq!(fs::read(target).unwrap(), b"source");
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_source_hardlink_and_symlink_targets() {
        let root = temporary_directory("source-links");
        let source = root.join("source.md");
        let hardlink = root.join("hard.md");
        let link = root.join("link.md");
        fs::write(&source, b"source").unwrap();
        fs::hard_link(&source, &hardlink).unwrap();
        std::os::unix::fs::symlink(&source, &link).unwrap();
        for path in [hardlink, link] {
            assert!(publish_export_with(
                &path,
                b"replacement",
                &[source.clone()],
                publish_snapshot
            )
            .is_err());
        }
        assert_eq!(fs::read(source).unwrap(), b"source");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saves_and_lists_newest_exports_first() {
        let root = temporary_directory("sorted");
        let older = record(&root, "older", "2026-08-09T01:00:00.000Z");
        let newer = record(&root, "newer", "2026-08-09T02:00:00.000Z");
        fs::write(&older.path, b"older").expect("older export");
        fs::write(&newer.path, b"newer").expect("newer export");
        save_snapshot_at(&root, &snapshot(vec![older, newer])).expect("save snapshot");

        let records = list_records_at(&root).expect("list records");

        assert_eq!(records[0].id, "newer");
        assert_eq!(records[1].id, "older");
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn marks_an_export_missing_when_its_file_disappears() {
        let root = temporary_directory("missing");
        let export = record(&root, "removed", "2026-08-09T01:00:00.000Z");
        fs::write(&export.path, b"content").expect("export file");
        save_snapshot_at(&root, &snapshot(vec![export.clone()])).expect("save snapshot");
        fs::remove_file(&export.path).expect("remove export file");

        let records = list_records_at(&root).expect("list records");

        assert_eq!(records[0].status, ArtifactExportStatus::Missing);
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn removing_history_keeps_the_exported_file() {
        let root = temporary_directory("remove-record");
        let export = record(&root, "kept", "2026-08-09T01:00:00.000Z");
        fs::write(&export.path, b"content").expect("export file");
        save_snapshot_at(&root, &snapshot(vec![export.clone()])).expect("save snapshot");

        remove_record_at(&root, &export.id).expect("remove record");

        assert!(export.path.is_file());
        assert!(list_records_at(&root).expect("list records").is_empty());
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn quarantines_a_malformed_snapshot() {
        let root = temporary_directory("corrupt");
        let directory = root.join("artifact-exports");
        fs::create_dir_all(&directory).expect("history directory");
        fs::write(directory.join("history.v1.json"), b"not json").expect("corrupt history");

        let error = list_records_at(&root).expect_err("malformed snapshot");

        assert!(error.contains("导出历史已损坏"));
        let quarantined = fs::read_dir(directory)
            .expect("history directory")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(quarantined);
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn resolves_paths_only_from_existing_record_ids() {
        let root = temporary_directory("checked-path");
        let export = record(&root, "known", "2026-08-09T01:00:00.000Z");
        fs::write(&export.path, b"content").expect("export file");
        save_snapshot_at(&root, &snapshot(vec![export.clone()])).expect("save snapshot");

        let error = find_available_record_at(&root, "../../arbitrary")
            .expect_err("unknown record must not resolve");

        assert!(error.contains("找不到导出记录"));
        assert_eq!(
            find_available_record_at(&root, &export.id)
                .expect("known record")
                .path,
            export.path
        );
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn reports_the_saved_path_when_history_cannot_be_updated() {
        let root = temporary_directory("history-failure");
        let directory = root.join("artifact-exports");
        fs::create_dir_all(&directory).expect("history directory");
        fs::write(directory.join("history.v1.json"), b"not json").expect("corrupt history");
        let export = record(&root, "already-saved", "2026-08-09T01:00:00.000Z");
        fs::write(&export.path, b"content").expect("export file");

        let error = persist_record_after_file_save_at(&root, export.clone())
            .expect_err("history update must fail");

        assert!(error.contains("文件已保存，但未写入导出历史"));
        assert!(error.contains(&export.path.display().to_string()));
        assert!(export.path.is_file());
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn keeps_the_previous_snapshot_when_publish_fails() {
        let root = temporary_directory("publish-failure");
        let previous = record(&root, "previous", "2026-08-09T01:00:00.000Z");
        save_snapshot_at(&root, &snapshot(vec![previous.clone()])).expect("save previous snapshot");
        let replacement = record(&root, "replacement", "2026-08-09T02:00:00.000Z");

        let error = save_snapshot_with_publisher_at(
            &root,
            &snapshot(vec![replacement]),
            |_temporary_path, target_path| {
                let serialized =
                    fs::read(target_path).expect("previous snapshot remains published");
                let stored: serde_json::Value =
                    serde_json::from_slice(&serialized).expect("valid previous snapshot");
                assert_eq!(stored["records"][0]["id"], "previous");
                Err("simulated publish failure".to_string())
            },
        )
        .expect_err("publish must fail");

        assert!(error.contains("simulated publish failure"));
        let records = list_records_at(&root).expect("read previous snapshot");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, previous.id);
        fs::remove_dir_all(root).expect("remove temporary directory");
    }
}
