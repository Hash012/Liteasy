//! Application data is staged as versioned logical records, then restored before editors open.
use super::{local, model, options::SyncOptions, secrets, Settings};
use crate::{local_library::write_bytes_atomically, note_files::store::FileStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
const PREFIX: &str = ".liteasy/sync-data/";
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserData {
    #[serde(default)]
    pub preferences: BTreeMap<String, String>,
    #[serde(default)]
    pub credentials: Vec<Value>,
}
#[derive(Deserialize, Serialize)]
struct Pending {
    path: String,
    scope: String,
    previous_hash: Option<String>,
    connection: String,
}
fn encode(value: &Value) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|e| e.to_string())
}
fn object_snapshot(
    app: &AppHandle,
    scope: &str,
    external: bool,
) -> Result<Option<Vec<u8>>, String> {
    let value = crate::object_store::sync_export(app, scope, external)?;
    if value["records"].as_array().is_some_and(Vec::is_empty) {
        Ok(None)
    } else {
        encode(&value).map(Some)
    }
}
fn store(app: &AppHandle, scope: &str) -> Result<FileStore, String> {
    FileStore::open(
        &crate::data_location::root(app).map_err(|e| e.to_string())?,
        scope,
    )
}
fn scoped_path(category: &str, scope: &str, name: &str) -> String {
    format!(
        "{PREFIX}{category}/{}/{name}",
        model::digest(scope.as_bytes())
    )
}
pub fn includes(options: &SyncOptions, scope: &str, path: &str) -> bool {
    options.includes(path)
        && (!path.starts_with(PREFIX)
            || path.split('/').nth(3) == Some(model::digest(scope.as_bytes()).as_str()))
}
fn pending_dir(root: &Path) -> Result<PathBuf, String> {
    let dir = local::state_directory(root)?.join("pending-records");
    if dir.exists()
        && fs::symlink_metadata(&dir)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("同步暂存目录不安全".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
pub fn has_pending(root: &Path, scope: &str) -> Result<bool, String> {
    for entry in fs::read_dir(pending_dir(root)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let record: Pending =
            serde_json::from_slice(&fs::read(entry.path()).map_err(|e| e.to_string())?)
                .map_err(|_| "同步暂存记录损坏")?;
        if record.scope == scope {
            return Ok(true);
        }
    }
    Ok(false)
}
pub fn valid_preference(key: &str, scope: &str) -> bool {
    let scope = if scope == "local" { "guest" } else { scope };
    matches!(
        key,
        "liteasy.model-connection.v1"
            | "liteasy.verified-models.v1"
            | "liteasy.view-settings.v1"
            | "liteasy.recommendation-settings.v1"
            | "liteasy.local-literature.v1"
    ) || [
        "liteasy.academic-profile.v1:",
        "liteasy.profile-memory.v1:",
        "liteasy.local-research-profile.v1:",
        "liteasy.library.icons.v1:",
    ]
    .iter()
    .any(|prefix| key == format!("{prefix}{scope}"))
}
pub fn prepare(
    app: &AppHandle,
    root: &Path,
    settings: &Settings,
    browser: &BrowserData,
) -> Result<(), String> {
    let scope = crate::desktop_identity::local_object_scope()?;
    if has_pending(root, &scope)? {
        return Err("已下载笔记或设置。请重启 Liteasy 载入后再同步；当前编辑内容会保留。".into());
    }
    let credentials = secrets::merge_descriptors(root, &scope, &browser.credentials)?;
    let mut snapshots = std::collections::BTreeSet::new();
    let mut stage = |path: String, bytes: Vec<u8>| -> Result<(), String> {
        write_bytes_atomically(&local::safe_path(root, &path)?, &bytes)?;
        snapshots.insert(path);
        Ok(())
    };
    if settings.sync.workspace {
        if let Some(bytes) = object_snapshot(app, &scope, false)? {
            stage(scoped_path("objects", &scope, "records.json"), bytes)?;
        }
    }
    if settings.sync.external_folders {
        if let Some(bytes) = object_snapshot(app, &scope, true)? {
            stage(scoped_path("external", &scope, "records.json"), bytes)?;
        }
    }
    let files = store(app, &scope)?;
    for mount in files.mounts()? {
        let category = if mount.managed { "boards" } else { "external" };
        if (mount.managed && settings.sync.workspace)
            || (!mount.managed && settings.sync.external_folders)
        {
            stage(
                scoped_path(category, &scope, &format!("mount-{}.json", mount.id)),
                encode(&files.sync_export(&mount.id)?)?,
            )?;
        }
    }
    if settings.sync.history {
        if let Some(value) = crate::assistant_history::load_assistant_history(app.clone())? {
            stage(
                scoped_path("history", &scope, "assistant.json"),
                encode(&value)?,
            )?;
        }
    }
    if settings.sync.workspace {
        if let Some(value) =
            crate::artifact_catalog_state::load_artifact_catalog_state(app.clone())?
        {
            stage(
                scoped_path("objects", &scope, "catalog.json"),
                encode(&value)?,
            )?;
        }
    }
    if settings.sync.preferences {
        if browser.preferences.len() > 100
            || browser
                .preferences
                .iter()
                .any(|(key, value)| !valid_preference(key, &scope) || value.len() > 4 * 1024 * 1024)
        {
            return Err("偏好同步字段无效或过大".into());
        }
        stage(
            scoped_path("preferences", &scope, "settings.json"),
            serde_json::to_vec(&browser.preferences).map_err(|e| e.to_string())?,
        )?;
    }
    if settings.sync.api_keys {
        let path = scoped_path("keys", &scope, "encrypted.json");
        let previous = local::read_file(&local::safe_path(root, &path)?)?;
        if let Some(bytes) = secrets::export(settings, root, &credentials, previous.as_deref())? {
            stage(path, bytes)?;
        }
    }
    // Remove obsolete staging only for enabled categories. Disabled categories never become deletions.
    let mut staged = model::Files::new();
    local::collect_selected(
        root,
        &root.join(".liteasy/sync-data"),
        &mut staged,
        &|path| includes(&settings.sync, &scope, path),
    )?;
    for path in staged
        .keys()
        .filter(|p| includes(&settings.sync, &scope, p) && !snapshots.contains(*p))
    {
        fs::remove_file(local::safe_path(root, path)?).map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn queue(
    root: &Path,
    settings: &Settings,
    scope: &str,
    path: &str,
    expected: Option<&str>,
    bytes: Option<&[u8]>,
) -> Result<(), String> {
    if !includes(&settings.sync, scope, path) {
        return Err("同步数据不属于当前账号或范围".into());
    }
    if local::current_hash(root, path)?.as_deref() != expected {
        return Err("同步期间数据已改变，请重新同步".into());
    }
    // Removing a connected directory on a peer must never remove an independently linked local directory.
    let Some(bytes) = bytes else {
        return Ok(());
    };
    validate_record(settings, root, scope, path, bytes)?;
    let pending = pending_dir(root)?.join(format!("{}.json", model::digest(path.as_bytes())));
    let old = local::read_file(&local::safe_path(root, path)?)?;
    if let Some(old) = old {
        write_bytes_atomically(
            &local::state_directory(root)?.join("recovery").join(format!(
                "{}-{}.json",
                model::digest(path.as_bytes()),
                model::digest(&old)
            )),
            &old,
        )?;
    }
    // Incoming content is durable before journal publication; the engine updates staging afterward.
    write_bytes_atomically(
        &local::state_directory(root)?
            .join("incoming-data")
            .join(model::digest(path.as_bytes())),
        bytes,
    )?;
    local::save_json(
        &pending,
        &Pending {
            path: path.into(),
            scope: scope.into(),
            previous_hash: expected.map(str::to_owned),
            connection: settings.key(),
        },
    )
}
fn source(
    app: &AppHandle,
    root: &Path,
    settings: &Settings,
    scope: &str,
    path: &str,
) -> Result<Option<Vec<u8>>, String> {
    let parts: Vec<_> = path.split('/').collect();
    let name = parts[4];
    let category = parts[2];
    if name == "records.json" && matches!(category, "objects" | "external") {
        return object_snapshot(app, scope, category == "external");
    }
    if let Some(id) = name
        .strip_prefix("mount-")
        .and_then(|s| s.strip_suffix(".json"))
    {
        let files = store(app, scope)?;
        return if files.mounts()?.iter().any(|m| m.id == id) {
            Ok(Some(encode(&files.sync_export(id)?)?))
        } else {
            Ok(None)
        };
    }
    let value = match (category, name) {
        ("history", "assistant.json") => {
            crate::assistant_history::load_assistant_history(app.clone())?
        }
        ("objects", "catalog.json") => {
            crate::artifact_catalog_state::load_artifact_catalog_state(app.clone())?
        }
        ("keys", "encrypted.json") => {
            let descriptors: Vec<Value> = serde_json::from_slice(
                &fs::read(local::state_directory(root)?.join(format!(
                    "key-configs-{}.json",
                    model::digest(scope.as_bytes())
                )))
                .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            // Use the pre-download snapshot to preserve stable encryption when keys are unchanged.
            let pending: Pending = serde_json::from_slice(
                &fs::read(
                    pending_dir(root)?.join(format!("{}.json", model::digest(path.as_bytes()))),
                )
                .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let old = pending.previous_hash.and_then(|hash| {
                fs::read(
                    local::state_directory(root)
                        .ok()?
                        .join("recovery")
                        .join(format!("{}-{hash}.json", model::digest(path.as_bytes()))),
                )
                .ok()
            });
            return secrets::export(settings, root, &descriptors, old.as_deref());
        }
        _ => return Err("未知同步记录，已保留原始数据".into()),
    };
    value.map(|v| encode(&v)).transpose()
}
fn apply(
    app: &AppHandle,
    root: &Path,
    settings: &Settings,
    scope: &str,
    path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "同步数据不是有效 JSON")?;
    let pending: Pending = serde_json::from_slice(
        &fs::read(pending_dir(root)?.join(format!("{}.json", model::digest(path.as_bytes()))))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let previous = pending
        .previous_hash
        .and_then(|hash| {
            fs::read(
                local::state_directory(root)
                    .ok()?
                    .join("recovery")
                    .join(format!("{}-{hash}.json", model::digest(path.as_bytes()))),
            )
            .ok()
        })
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let parts: Vec<_> = path.split('/').collect();
    match (parts[2], parts[4]) {
        ("objects" | "external", "records.json") => {
            crate::object_store::sync_import(app, scope, &value, previous.as_ref())
        }
        ("boards" | "external", name) if name.starts_with("mount-") => {
            if name != format!("mount-{}.json", value["id"].as_str().unwrap_or(""))
                || value["managed"].as_bool() != Some(parts[2] == "boards")
            {
                return Err("笔记目录记录不匹配".into());
            }
            store(app, scope)?.sync_import(
                &crate::data_location::root(app).map_err(|e| e.to_string())?,
                &value,
                previous.as_ref(),
            )
        }
        ("history", "assistant.json") => {
            crate::assistant_history::save_assistant_history(app.clone(), value)
        }
        ("objects", "catalog.json") => {
            crate::artifact_catalog_state::save_artifact_catalog_state(app.clone(), value)
        }
        ("keys", "encrypted.json") => secrets::import(settings, root, bytes),
        _ => Err("不支持的同步记录版本".into()),
    }
}
fn restore_previous_baseline(root: &Path, pending: &Pending) -> Result<(), String> {
    let checkpoint =
        local::state_directory(root)?.join(format!("baseline-{}.json", pending.connection));
    if !checkpoint.exists() {
        return Ok(());
    }
    let mut manifest =
        model::Manifest::from_bytes(&fs::read(&checkpoint).map_err(|e| e.to_string())?)?;
    let previous = pending
        .previous_hash
        .as_ref()
        .map(|hash| {
            let bytes = fs::read(local::state_directory(root)?.join("recovery").join(format!(
                "{}-{hash}.json",
                model::digest(pending.path.as_bytes())
            )))
            .map_err(|e| e.to_string())?;
            Ok::<_, String>(model::FileVersion {
                hash: hash.clone(),
                size: bytes.len() as u64,
                document_id: None,
            })
        })
        .transpose()?;
    manifest.files.insert(pending.path.clone(), previous);
    local::save_json(&checkpoint, &manifest)
}
/// Runs before this account opens its editors. Locally edited snapshots are never overwritten.
pub fn recover(app: &AppHandle) -> Result<(), String> {
    let root = crate::local_library::library_root(app)?;
    let settings = super::load_settings(&root)?;
    let scope = crate::desktop_identity::local_object_scope()?;
    let mut entries = fs::read_dir(pending_dir(&root)?)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    entries.sort_by_key(|entry| {
        fs::read(entry.path())
            .ok()
            .and_then(|b| serde_json::from_slice::<Pending>(&b).ok())
            .map(|p| (!p.path.contains("/mount-"), p.path))
    });
    for entry in entries {
        let pending: Pending =
            serde_json::from_slice(&fs::read(entry.path()).map_err(|e| e.to_string())?)
                .map_err(|_| "同步暂存记录损坏")?;
        if pending.scope != scope || pending.path.contains("/preferences/") {
            continue;
        }
        if !includes(&settings.sync, &scope, &pending.path) || settings.key() != pending.connection
        {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
            continue;
        }
        if pending.path.split('/').count() != 5 || !model::allowed_path(&pending.path) {
            return Err("同步暂存路径无效".into());
        }
        let bytes = fs::read(
            local::state_directory(&root)?
                .join("incoming-data")
                .join(model::digest(pending.path.as_bytes())),
        )
        .map_err(|e| e.to_string())?;
        let current = match source(app, &root, &settings, &scope, &pending.path) {
            Ok(current) => current,
            Err(error) => {
                restore_previous_baseline(&root, &pending)?;
                local::save_json(
                    &local::state_directory(&root)?.join("restore-notice.json"),
                    &json!(format!(
                        "部分数据无法恢复：{error}。已保留本地内容及下载副本。"
                    )),
                )?;
                fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
                continue;
            }
        };
        if current.as_deref() == Some(bytes.as_slice()) {
            // A previous startup applied the payload before clearing its journal.
        } else if current.as_deref().map(model::digest) == pending.previous_hash {
            if let Err(error) = apply(app, &root, &settings, &scope, &pending.path, &bytes) {
                restore_previous_baseline(&root, &pending)?;
                local::save_json(
                    &local::state_directory(&root)?.join("restore-notice.json"),
                    &json!(format!(
                        "部分同步数据未载入：{error}。原始数据保留在 incoming-data，可继续同步。"
                    )),
                )?;
            }
        } else {
            restore_previous_baseline(&root, &pending)?;
            // Keep the newer local edits; retain the incoming version for recovery and report it.
            local::save_json(&local::state_directory(&root)?.join("restore-notice.json"),&json!("同步下载后本地内容又发生变化，已保留本地编辑；远端副本保留在 .liteasy/webdav/incoming-data。请再次同步处理差异。"))?;
        }
        fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn restore_webdav_preferences(
    app: AppHandle,
    preferences: BTreeMap<String, String>,
) -> Result<Value, String> {
    let root = crate::local_library::library_root(&app)?;
    let settings = super::load_settings(&root)?;
    let scope = crate::desktop_identity::local_object_scope()?;
    static RESTORED: std::sync::Mutex<Option<std::collections::BTreeSet<String>>> =
        std::sync::Mutex::new(None);
    let mut restored = RESTORED.lock().map_err(|_| "同步恢复忙碌")?;
    let restored = restored.get_or_insert_with(Default::default);
    if restored.contains(&scope) {
        return Ok(json!({}));
    }
    if let Err(error) = recover(&app) {
        local::save_json(
            &local::state_directory(&root)?.join("restore-notice.json"),
            &json!(format!("同步数据恢复未完成：{error}")),
        )?;
    }
    restored.insert(scope.clone());
    let path = scoped_path("preferences", &scope, "settings.json");
    let pending_path = pending_dir(&root)?.join(format!("{}.json", model::digest(path.as_bytes())));
    let notice = local::state_directory(&root)?.join("restore-notice.json");
    let message = fs::read(&notice)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    if !pending_path.exists() || !settings.sync.preferences {
        return Ok(json!({"message":message}));
    }
    let pending: Pending =
        serde_json::from_slice(&fs::read(&pending_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if settings.key() != pending.connection {
        return Ok(json!({"message":message}));
    }
    let old: BTreeMap<String, String> = pending
        .previous_hash
        .and_then(|hash| {
            fs::read(
                local::state_directory(&root)
                    .ok()?
                    .join("recovery")
                    .join(format!("{}-{hash}.json", model::digest(path.as_bytes()))),
            )
            .ok()
        })
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let incoming: BTreeMap<String, String> = serde_json::from_slice(
        &fs::read(
            local::state_directory(&root)?
                .join("incoming-data")
                .join(model::digest(path.as_bytes())),
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut result = preferences.clone();
    for key in old.keys().chain(incoming.keys()) {
        if valid_preference(key, &scope) && preferences.get(key) == old.get(key) {
            if let Some(value) = incoming.get(key) {
                result.insert(key.clone(), value.clone());
            } else {
                result.remove(key);
            }
        }
    }
    // Renderer acknowledges only after localStorage was saved successfully.
    Ok(json!({"preferences":result,"message":message,"pending":true}))
}
#[tauri::command]
pub fn acknowledge_webdav_preferences(app: AppHandle) -> Result<(), String> {
    let root = crate::local_library::library_root(&app)?;
    let scope = crate::desktop_identity::local_object_scope()?;
    let path = scoped_path("preferences", &scope, "settings.json");
    let file = pending_dir(&root)?.join(format!("{}.json", model::digest(path.as_bytes())));
    if file.exists() {
        fs::remove_file(file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate_record(
    settings: &Settings,
    root: &Path,
    scope: &str,
    path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 5 || !model::allowed_path(path) {
        return Err("同步记录路径无效".into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "同步记录不是有效 JSON")?;
    match (parts[2], parts[4]) {
        ("objects" | "external", "records.json") => {
            if value["version"] != 1
                || value["scope"].as_str() != Some(scope)
                || value["external"].as_bool() != Some(parts[2] == "external")
                || !value["records"].is_array()
            {
                return Err("笔记记录版本或账号不匹配".into());
            }
        }
        ("boards" | "external", name) if name.starts_with("mount-") => {
            if value["version"] != 1
                || name != format!("mount-{}.json", value["id"].as_str().unwrap_or(""))
                || value["managed"].as_bool() != Some(parts[2] == "boards")
                || !value["files"].is_object()
            {
                return Err("笔记目录记录无效".into());
            }
        }
        ("history", "assistant.json") => {
            if value["version"] != "liteasy.assistant-history/v1" || !value["sessions"].is_array() {
                return Err("对话历史版本不匹配".into());
            }
        }
        ("objects", "catalog.json") => {
            if value["version"] != "liteasy.artifact-catalog/v1" || !value["artifacts"].is_array() {
                return Err("产物目录格式无效".into());
            }
        }
        ("preferences", "settings.json") => {
            let preferences: BTreeMap<String, String> =
                serde_json::from_value(value).map_err(|_| "偏好数据格式无效")?;
            if preferences.len() > 100
                || preferences.iter().any(|(key, value)| {
                    !valid_preference(key, scope)
                        || value.len() > 4 * 1024 * 1024
                        || serde_json::from_str::<Value>(value).is_err()
                })
            {
                return Err("偏好数据包含不支持的字段".into());
            }
        }
        ("keys", "encrypted.json") => secrets::verify(settings, root, bytes)?,
        _ => return Err("不支持的同步记录类型".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn data_scope_and_preference_allowlist_do_not_leak_accounts_or_credentials() {
        let options = SyncOptions::default();
        assert!(includes(
            &options,
            "local",
            &scoped_path("objects", "local", "records.json")
        ));
        assert!(!includes(
            &options,
            "user:alice",
            &scoped_path("objects", "user:bob", "records.json")
        ));
        assert!(valid_preference("liteasy.profile-memory.v1:guest", "local"));
        assert!(!valid_preference(
            "liteasy.profile-memory.v1:user:bob",
            "user:alice"
        ));
        assert!(!valid_preference("liteasy.account.session.v1", "local"));
        assert!(!valid_preference("access_token", "local"));
    }
    #[test]
    fn queued_workspace_updates_are_durable_and_compare_against_scanned_version() {
        let root =
            std::env::temp_dir().join(format!("liteasy-sync-workspace-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let settings = Settings::default();
        let path = scoped_path("objects", "local", "records.json");
        let old = br#"{"version":1,"scope":"local","external":false,"records":[]}"#;
        write_bytes_atomically(&local::safe_path(&root, &path).unwrap(), old).unwrap();
        let incoming =
            br#"{"version":1,"scope":"local","external":false,"records":[{"key":"head/note"}]}"#;
        assert!(queue(
            &root,
            &settings,
            "local",
            &path,
            Some("wrong"),
            Some(incoming)
        )
        .is_err());
        assert!(!has_pending(&root, "local").unwrap());
        queue(
            &root,
            &settings,
            "local",
            &path,
            Some(&model::digest(old)),
            Some(incoming),
        )
        .unwrap();
        let checkpoint = local::state_directory(&root)
            .unwrap()
            .join(format!("baseline-{}.json", settings.key()));
        let mut acknowledged = model::Manifest {
            schema_version: 2,
            files: model::Files::new(),
        };
        acknowledged.files.insert(
            path.clone(),
            Some(model::FileVersion {
                hash: model::digest(incoming),
                size: incoming.len() as u64,
                document_id: None,
            }),
        );
        local::save_json(&checkpoint, &acknowledged).unwrap();
        restore_previous_baseline(
            &root,
            &Pending {
                path: path.clone(),
                scope: "local".into(),
                previous_hash: Some(model::digest(old)),
                connection: settings.key(),
            },
        )
        .unwrap();
        let baseline = model::Manifest::from_bytes(&fs::read(checkpoint).unwrap()).unwrap();
        let edited = model::FileVersion {
            hash: model::digest(b"continued local edit"),
            size: 20,
            document_id: None,
        };
        assert_eq!(
            model::action(
                baseline.files[&path].as_ref(),
                Some(&edited),
                acknowledged.files[&path].as_ref()
            ),
            model::Action::Conflict
        );
        assert!(has_pending(&root, "local").unwrap());
        assert!(!has_pending(&root, "user:other").unwrap());
        assert_eq!(
            fs::read(local::safe_path(&root, &path).unwrap()).unwrap(),
            old
        );
        assert!(validate_record(&settings, &root, "user:other", &path, incoming).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
