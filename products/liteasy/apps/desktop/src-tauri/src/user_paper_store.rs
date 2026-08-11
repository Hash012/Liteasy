use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::local_library::{artifacts_directory, library_root};

const MAX_USER_PAPER_ARTIFACT_BYTES: u64 = 32 * 1024 * 1024;

fn artifact_kind_is_allowed(kind: &str) -> bool {
    matches!(
        kind,
        // "fulltext" belongs in the library, never the cache: OCR is not reproducible, and
        // every anchor and highlight is positioned against these text offsets. Re-extracting
        // after a cache wipe would drift them all at once.
        "annotations"
            | "anchor-graph"
            | "anchors"
            | "bibliographic-identity"
            | "citations"
            | "fulltext"
            | "literature-resolution"
            | "reader-state"
    )
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub(crate) fn paper_artifact_directory_name(paper_id: &str) -> Result<String, String> {
    let paper_id = paper_id.trim();
    if paper_id.is_empty() || paper_id.len() > 512 {
        return Err("论文标识无效。".to_string());
    }
    let stem: String = paper_id
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else if matches!(character, '-' | '_' | '.') {
                Some(character)
            } else {
                None
            }
        })
        .take(40)
        .collect();
    let stem = if stem.is_empty() { "paper" } else { &stem };
    Ok(format!("{stem}-{:016x}", stable_hash(paper_id)))
}

fn artifact_path(app: &AppHandle, paper_id: &str, artifact_kind: &str) -> Result<PathBuf, String> {
    if !artifact_kind_is_allowed(artifact_kind) {
        return Err("不支持的用户阅读产物类型。".to_string());
    }
    let paper_directory = paper_artifact_directory_name(paper_id)?;
    // Resolved from the library root rather than a fixed path, so moving the library also
    // moves the annotations, anchors and full text that belong to it.
    Ok(artifacts_directory(&library_root(app)?)
        .join(paper_directory)
        .join(format!("{artifact_kind}.v1.json")))
}

fn write_json_atomically(path: &PathBuf, serialized: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "用户阅读产物路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建用户存储目录：{error}"))?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = parent.join(format!(".artifact.{nonce}.{}.tmp", std::process::id()));
    let save_result = (|| -> Result<(), String> {
        let mut temporary = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| format!("无法创建用户阅读产物临时文件：{error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("无法保护用户阅读产物：{error}"))?;
        }
        temporary
            .write_all(serialized)
            .and_then(|_| temporary.sync_all())
            .map_err(|error| format!("无法写入用户阅读产物：{error}"))?;

        #[cfg(windows)]
        let backup_path = if path.exists() {
            let backup = parent.join(format!(".artifact.{nonce}.{}.backup", std::process::id()));
            fs::rename(path, &backup).map_err(|error| {
                format!("Could not create a safe backup for the existing user artifact: {error}")
            })?;
            Some(backup)
        } else {
            None
        };

        #[cfg(windows)]
        match fs::rename(&temporary_path, path) {
            Ok(()) => {
                if let Some(backup) = backup_path {
                    let _ = fs::remove_file(backup);
                }
            }
            Err(error) => {
                let restore_error = backup_path
                    .as_ref()
                    .and_then(|backup| fs::rename(backup, path).err());
                return Err(match restore_error {
                    Some(restore_error) => format!(
                        "无法发布用户阅读产物，恢复旧版本也失败：{error}；恢复错误：{restore_error}"
                    ),
                    None => format!("无法发布用户阅读产物，已恢复旧版本：{error}"),
                });
            }
        }

        #[cfg(not(windows))]
        fs::rename(&temporary_path, path)
            .map_err(|error| format!("无法发布用户阅读产物：{error}"))?;

        Ok(())
    })();

    if save_result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    save_result
}

fn decode_user_paper_artifact(serialized: &[u8]) -> Result<Option<Value>, String> {
    let value: Value = serde_json::from_slice(serialized)
        .map_err(|error| format!("用户阅读产物格式损坏：{error}"))?;
    if value.is_null() {
        return Err("用户阅读产物格式损坏：不能保存 JSON null。".to_string());
    }
    Ok(Some(value))
}

#[tauri::command]
pub fn load_user_paper_artifact(
    app: AppHandle,
    paper_id: String,
    artifact_kind: String,
) -> Result<Option<Value>, String> {
    let path = artifact_path(&app, &paper_id, &artifact_kind)?;
    if !path.exists() {
        return Ok(None);
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("无法读取用户阅读产物信息：{error}"))?;
    if metadata.len() > MAX_USER_PAPER_ARTIFACT_BYTES {
        return Err("用户阅读产物超过大小限制。".to_string());
    }
    let serialized = fs::read(&path).map_err(|error| format!("无法读取用户阅读产物：{error}"))?;
    decode_user_paper_artifact(&serialized)
}

#[tauri::command]
pub fn save_user_paper_artifact(
    app: AppHandle,
    paper_id: String,
    artifact_kind: String,
    snapshot: Value,
) -> Result<(), String> {
    let serialized =
        serde_json::to_vec(&snapshot).map_err(|error| format!("无法编码用户阅读产物：{error}"))?;
    if serialized.len() as u64 > MAX_USER_PAPER_ARTIFACT_BYTES {
        return Err("用户阅读产物超过大小限制。".to_string());
    }
    let path = artifact_path(&app, &paper_id, &artifact_kind)?;
    write_json_atomically(&path, &serialized)
}

#[cfg(test)]
mod tests {
    use super::{
        artifact_kind_is_allowed, decode_user_paper_artifact, paper_artifact_directory_name,
        write_json_atomically,
    };
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("liteasy-{name}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&directory).expect("create temporary artifact directory");
        directory
    }

    #[test]
    fn only_allows_known_user_artifact_kinds() {
        assert!(artifact_kind_is_allowed("annotations"));
        assert!(artifact_kind_is_allowed("anchor-graph"));
        assert!(artifact_kind_is_allowed("bibliographic-identity"));
        assert!(artifact_kind_is_allowed("literature-resolution"));
        assert!(artifact_kind_is_allowed("citations"));
        assert!(!artifact_kind_is_allowed("../../outside"));
    }

    #[test]
    fn turns_arbitrary_paper_identity_into_single_directory_name() {
        let directory =
            paper_artifact_directory_name("doi:10.1000/example/42").expect("safe directory");
        // Dots survive because they are safe inside a single path segment; separators do not.
        assert!(directory.starts_with("doi10.1000example42-"));
        assert!(!directory.contains('/'));
        assert!(!directory.contains('\\'));
    }

    #[test]
    fn atomically_creates_and_replaces_a_paper_artifact() {
        let root = temporary_directory("paper-artifact-atomic-write");
        let path = root
            .join("paper-artifacts")
            .join("document-1")
            .join("annotations.v1.json");
        write_json_atomically(
            &path,
            &serde_json::to_vec(&json!({ "revision": 1 })).unwrap(),
        )
        .expect("write first artifact");
        write_json_atomically(
            &path,
            &serde_json::to_vec(&json!({ "revision": 2 })).unwrap(),
        )
        .expect("replace artifact");

        let stored: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("read stored artifact"))
                .expect("decode stored artifact");
        assert_eq!(stored, json!({ "revision": 2 }));
        let siblings = fs::read_dir(path.parent().unwrap())
            .expect("read artifact directory")
            .collect::<Result<Vec<_>, _>>()
            .expect("read artifact entries");
        assert_eq!(siblings.len(), 1);

        fs::remove_dir_all(root).expect("remove temporary artifact directory");
    }

    #[test]
    fn rejects_null_user_paper_artifacts_as_corrupt() {
        assert!(decode_user_paper_artifact(b"null").is_err());
    }
}
