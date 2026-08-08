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
use tauri::{AppHandle, Manager};

const EXPORT_HISTORY_VERSION: &str = "liteasy.artifact-export-history/v1";
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
}

impl ArtifactExportFormat {
    fn extension(&self) -> &'static str {
        match self {
            Self::Html => "html",
            Self::Markdown => "md",
            Self::Pdf => "pdf",
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Self::Html => "HTML",
            Self::Markdown => "Markdown",
            Self::Pdf => "PDF",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactExportStatus {
    Available,
    Missing,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactExportInput {
    artifact_id: String,
    content: String,
    content_encoding: ArtifactContentEncoding,
    file_name: String,
    format: ArtifactExportFormat,
    title: String,
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
    Saved { record: ArtifactExportRecord },
}

#[derive(Deserialize, Serialize)]
struct ArtifactExportSnapshot {
    records: Vec<ArtifactExportRecord>,
    version: String,
}

fn snapshot(records: Vec<ArtifactExportRecord>) -> ArtifactExportSnapshot {
    ArtifactExportSnapshot {
        records,
        version: EXPORT_HISTORY_VERSION.to_string(),
    }
}

fn history_path_at(app_data: &Path) -> PathBuf {
    app_data.join("artifact-exports").join("history.v1.json")
}

fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("无法定位导出历史目录：{error}"))
}

fn timestamp_nonce() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn quarantine_corrupt_snapshot(path: &Path, reason: impl std::fmt::Display) -> String {
    let quarantined = path.with_file_name(format!(
        "history.v1.json.corrupt-{}-{}",
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
    let path = history_path_at(app_data);
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
    let parsed: ArtifactExportSnapshot = serde_json::from_slice(&serialized)
        .map_err(|error| quarantine_corrupt_snapshot(&path, error))?;
    if parsed.version != EXPORT_HISTORY_VERSION {
        return Err(quarantine_corrupt_snapshot(
            &path,
            format!("不支持的快照版本 {}", parsed.version),
        ));
    }
    Ok(parsed)
}

fn save_snapshot_at(app_data: &Path, snapshot: &ArtifactExportSnapshot) -> Result<(), String> {
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
        ".history.v1.{}.{}.tmp",
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
        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(&path).map_err(|error| format!("无法替换旧导出历史：{error}"))?;
        }
        fs::rename(&temporary_path, &path).map_err(|error| format!("无法发布导出历史：{error}"))?;
        Ok(())
    })();
    if result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

fn list_records_at(app_data: &Path) -> Result<Vec<ArtifactExportRecord>, String> {
    let mut history = read_snapshot_at(app_data)?;
    let mut changed = false;
    for record in &mut history.records {
        let next_status = if record.path.is_file() {
            ArtifactExportStatus::Available
        } else {
            ArtifactExportStatus::Missing
        };
        if record.status != next_status {
            record.status = next_status;
            changed = true;
        }
    }
    history
        .records
        .sort_by(|left, right| right.exported_at.cmp(&left.exported_at));
    if changed {
        save_snapshot_at(app_data, &history)?;
    }
    Ok(history.records)
}

fn remove_record_at(app_data: &Path, record_id: &str) -> Result<(), String> {
    let mut history = read_snapshot_at(app_data)?;
    history.records.retain(|record| record.id != record_id);
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
        history.records.push(record);
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
    let stem = truncate(&sanitized, MAX_FILE_NAME_CHARS.saturating_sub(5));
    let stem = if stem.trim().is_empty() {
        "Liteasy-artifact"
    } else {
        stem.trim()
    };
    format!("{stem}.{}", input.format.extension())
}

fn decode_content(input: &ArtifactExportInput) -> Result<Vec<u8>, String> {
    match input.content_encoding {
        ArtifactContentEncoding::Utf8 => Ok(input.content.as_bytes().to_vec()),
        ArtifactContentEncoding::Base64 => base64::engine::general_purpose::STANDARD
            .decode(&input.content)
            .map_err(|error| format!("无法解码导出内容：{error}")),
    }
}

fn force_format_extension(path: PathBuf, format: &ArtifactExportFormat) -> PathBuf {
    if path.extension().and_then(|value| value.to_str()) == Some(format.extension()) {
        path
    } else {
        path.with_extension(format.extension())
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
    let suggested_name = safe_suggested_file_name(&input);
    let selected = FileDialog::new()
        .add_filter(input.format.label(), &[input.format.extension()])
        .set_file_name(&suggested_name)
        .save_file();
    let Some(selected) = selected else {
        return Ok(ArtifactExportOutcome::Cancelled);
    };
    let selected = force_format_extension(selected, &input.format);
    fs::write(&selected, content).map_err(|error| format!("无法写入导出文件：{error}"))?;
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
    };
    let root =
        history_root(&app).map_err(|error| saved_file_history_error(&absolute_path, error))?;
    persist_record_after_file_save_at(&root, record.clone())?;
    Ok(ArtifactExportOutcome::Saved { record })
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
        remove_record_at, save_snapshot_at, snapshot, ArtifactExportFormat, ArtifactExportRecord,
        ArtifactExportStatus,
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
        }
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
}
