//! Account-partitioned local object records. Immutable revisions and all changed records
//! are committed together; SQLite WAL recovery handles interrupted commits.
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ObjectRow {
    key: String,
    version: String,
    value: Value,
}
#[derive(Debug, Deserialize)]
pub struct ObjectChange {
    key: String,
    expected: Option<String>,
    row: Option<ObjectRow>,
}
fn open(app: &AppHandle, scope: &str) -> Result<Connection, String> {
    // Scope is checked against the OAuth credential held by the host, never a model payload.
    let active = crate::desktop_identity::local_object_scope()?;
    if active != scope {
        return Err("object_forbidden".into());
    }
    let directory = crate::data_location::root(&app)
        .map_err(|e| e.to_string())?
        .join("objects");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let connection =
        Connection::open(directory.join("objects.v1.sqlite3")).map_err(|e| e.to_string())?;
    initialize(&connection).map_err(|e| e.to_string())?;
    Ok(connection)
}
fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS object_records (
          scope TEXT NOT NULL, key TEXT NOT NULL, version TEXT NOT NULL, value TEXT NOT NULL,
          PRIMARY KEY(scope, key)
        ) WITHOUT ROWID;",
    )
}
fn get(connection: &Connection, scope: &str, key: &str) -> Result<Option<ObjectRow>, String> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT version, value FROM object_records WHERE scope=?1 AND key=?2",
            params![scope, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|(version, value)| {
        Ok(ObjectRow {
            key: key.into(),
            version,
            value: serde_json::from_str(&value).map_err(|e| e.to_string())?,
        })
    })
    .transpose()
}
fn commit(
    connection: &mut Connection,
    scope: &str,
    changes: &[ObjectChange],
) -> Result<(), String> {
    if changes.len() > 1000 {
        return Err("persistence_failed: transaction too large".into());
    }
    let mut keys = std::collections::HashSet::new();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    for change in changes {
        if change.key.len() > 2048 || !keys.insert(&change.key) {
            return Err("persistence_failed: invalid key".into());
        }
        let previous = get(&tx, scope, &change.key)?;
        if previous.as_ref().map(|r| &r.version) != change.expected.as_ref() {
            return Err("revision_conflict".into());
        }
        if change.key.starts_with("revision/") && previous.is_some() {
            return Err("revision_conflict: immutable revision".into());
        }
        match &change.row {
            Some(row) => {
                if row.key != change.key || row.version.is_empty() {
                    return Err("persistence_failed: invalid row".into());
                }
                let serialized = serde_json::to_string(&row.value).map_err(|e| e.to_string())?;
                if serialized.len() > 32 * 1024 * 1024 {
                    return Err("persistence_failed: record too large".into());
                }
                tx.execute("INSERT INTO object_records(scope,key,version,value) VALUES (?1,?2,?3,?4)
                    ON CONFLICT(scope,key) DO UPDATE SET version=excluded.version,value=excluded.value",
                    params![scope, row.key, row.version, serialized]).map_err(|e| e.to_string())?;
            }
            None => {
                tx.execute(
                    "DELETE FROM object_records WHERE scope=?1 AND key=?2",
                    params![scope, change.key],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn object_store_get(
    app: AppHandle,
    scope: String,
    key: String,
) -> Result<Option<ObjectRow>, String> {
    let mut row = get(&open(&app, &scope)?, &scope, &key)?;
    if key.starts_with("asset/") {
        if let Some(ref mut row) = row {
            let hash = row.value["sha256"].as_str().ok_or("persistence_failed")?;
            let bytes = std::fs::read(asset_path(&app, &scope, hash)?)
                .map_err(|_| "persistence_failed: missing asset")?;
            if format!("{:x}", Sha256::digest(&bytes)) != hash {
                return Err("persistence_failed: asset hash mismatch".into());
            }
            row.value["base64"] = Value::String(STANDARD.encode(bytes));
        }
    }
    Ok(row)
}
#[tauri::command]
pub fn object_store_list(
    app: AppHandle,
    scope: String,
    prefix: String,
    after: String,
    limit: u32,
) -> Result<Vec<ObjectRow>, String> {
    let connection = open(&app, &scope)?;
    let start = if after.is_empty() {
        prefix.as_str()
    } else {
        after.as_str()
    };
    let end = format!("{prefix}\u{ffff}");
    let mut statement = connection.prepare("SELECT key,version,value FROM object_records WHERE scope=?1 AND key>=?2 AND key<?3 AND (?4='' OR key>?4) ORDER BY key LIMIT ?5").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![scope, start, end, after, limit.min(1000)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let (key, version, value) = row.map_err(|e| e.to_string())?;
        Ok(ObjectRow {
            key,
            version,
            value: serde_json::from_str(&value).map_err(|e| e.to_string())?,
        })
    })
    .collect()
}
#[tauri::command]
pub fn object_store_commit(
    app: AppHandle,
    scope: String,
    mut changes: Vec<ObjectChange>,
) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "persistence_failed")?;
    let mut connection = open(&app, &scope)?;
    let mut staged = Vec::new();
    let result = (|| -> Result<(), String> {
        for change in &mut changes {
            if !change.key.starts_with("asset/") {
                continue;
            }
            let row = change
                .row
                .as_mut()
                .ok_or("capability_denied: asset deletion requires retention policy")?;
            let encoded = row.value["base64"]
                .as_str()
                .ok_or("persistence_failed: missing asset data")?;
            if encoded.len() > 28 * 1024 * 1024 {
                return Err("persistence_failed: asset too large".into());
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "persistence_failed: invalid asset")?;
            let hash = format!("{:x}", Sha256::digest(&bytes));
            if row.value["sha256"].as_str() != Some(hash.as_str())
                || row.value["assetId"].as_str() != Some(hash.as_str())
                || row.value["byteLength"].as_u64() != Some(bytes.len() as u64)
                || change.key != format!("asset/{hash}")
            {
                return Err("persistence_failed: asset hash mismatch".into());
            }
            let path = asset_path(&app, &scope, &hash)?;
            if !path.exists() {
                use std::io::Write;
                std::fs::create_dir_all(path.parent().ok_or("persistence_failed")?)
                    .map_err(|e| e.to_string())?;
                let nonce = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                let temporary =
                    path.with_extension(format!("{}.{nonce}.staging", std::process::id()));
                let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| e.to_string())?;
                std::fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
                staged.push((change.key.clone(), path));
            }
            row.value
                .as_object_mut()
                .ok_or("persistence_failed")?
                .remove("base64");
        }
        if crate::desktop_identity::local_object_scope()? != scope {
            return Err("object_forbidden".into());
        }
        for change in &changes {
            let Some(row) = &change.row else {
                continue;
            };
            if !(row.key.starts_with("head/") || row.key.starts_with("revision/")) {
                continue;
            }
            if let Some(assets) = row.value["assets"].as_array() {
                for asset in assets {
                    let hash = asset["sha256"]
                        .as_str()
                        .ok_or("persistence_failed: missing asset hash")?;
                    let path = asset_path(&app, &scope, hash)?;
                    let bytes =
                        std::fs::read(path).map_err(|_| "persistence_failed: missing asset")?;
                    if format!("{:x}", Sha256::digest(&bytes)) != hash
                        || asset["byteLength"].as_u64() != Some(bytes.len() as u64)
                    {
                        return Err("persistence_failed: corrupt asset".into());
                    }
                }
            }
        }
        commit(&mut connection, &scope, &changes)
    })();
    if result.is_err() {
        for (key, path) in staged {
            if get(&connection, &scope, &key)?.is_none() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    result
}
fn asset_path(app: &AppHandle, scope: &str, hash: &str) -> Result<std::path::PathBuf, String> {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("persistence_failed: invalid asset id".into());
    }
    Ok(crate::data_location::root(&app)
        .map_err(|e| e.to_string())?
        .join("objects")
        .join("assets")
        .join(format!("{:x}", Sha256::digest(scope.as_bytes())))
        .join(hash))
}

// Local activation and grants never cross device boundaries.
fn sync_record_category(key: &str) -> Option<&'static str> {
    if [
        "extension-grant/",
        "extension-installation/",
        "extension-trigger/",
        "extension-trigger-event/",
        "extension-trial-data/",
        "object-attachment/",
    ]
    .iter()
    .any(|prefix| key.starts_with(prefix))
    {
        return None;
    }
    if key.starts_with("extension-package/") {
        return Some("extension-packages");
    }
    if key.starts_with("extension-config/")
        || key.starts_with("extension-config-history/")
        || key.starts_with("extension-view/")
    {
        return Some("extension-configuration");
    }
    if [
        "extension-draft/",
        "extension-draft-history/",
        "extension-trial/",
    ]
    .iter()
    .any(|prefix| key.starts_with(prefix))
    {
        return Some("extension-workflows");
    }
    if key.starts_with("workflow-run/") {
        return Some("extension-runs");
    }
    if key.starts_with("workflow-snapshot/") || key.starts_with("extension-operation/") {
        return Some("extension-snapshots");
    }
    Some("objects")
}

// Portable logical snapshots: never copy a live WAL database or local absolute paths.
pub(crate) fn sync_export(
    app: &AppHandle,
    scope: &str,
    external: bool,
    category: &str,
) -> Result<Value, String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "对象存储忙碌")?;
    let connection = open(app, scope)?;
    let mut statement = connection
        .prepare("SELECT key,version,value FROM object_records WHERE scope=?1 ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![scope], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut records = Vec::new();
    let mut size = 0usize;
    for row in rows {
        let (key, version, value) = row.map_err(|e| e.to_string())?;
        // Filter by stable record kind before parsing/loading unrelated large snapshots.
        let selected = sync_record_category(&key)
            == Some(if category == "external" {
                "objects"
            } else {
                category
            });
        let binding = key.starts_with("object-file/") || key.starts_with("board-file/");
        if key.starts_with("asset/") || (!selected && !binding) {
            continue;
        }
        size += value.len();
        if size > 96 * 1024 * 1024 || records.len() >= 100_000 {
            return Err("笔记同步数据过大，请分库同步。".into());
        }
        records.push(ObjectRow {
            key,
            version,
            value: serde_json::from_str(&value).map_err(|e| e.to_string())?,
        });
    }
    let managed_mounts = crate::note_files::sync_managed_mounts(app, scope)?;
    let external_ids: std::collections::HashSet<String> = records
        .iter()
        .filter(|r| r.key.starts_with("object-file/") || r.key.starts_with("board-file/"))
        .filter(|r| !managed_mounts.contains(r.value["mountId"].as_str().unwrap_or("")))
        .map(|r| r.key.split_once('/').unwrap().1.to_owned())
        .collect();
    records.retain(|r| {
        !r.key.starts_with("asset/")
            && sync_record_category(&r.key)
                == Some(if category == "external" {
                    "objects"
                } else {
                    category
                })
            && (if category == "objects" || category == "external" {
                external == sync_external_record(r, &external_ids)
            } else {
                external || !sync_external_record(r, &external_ids)
            })
    });
    let mut hashes = std::collections::BTreeSet::new();
    fn hashes_in(value: &Value, hashes: &mut std::collections::BTreeSet<String>) {
        match value {
            Value::Object(map) => {
                if let Some(hash) = map.get("sha256").and_then(Value::as_str) {
                    hashes.insert(hash.to_owned());
                }
                for v in map.values() {
                    hashes_in(v, hashes);
                }
            }
            Value::Array(items) => {
                for v in items {
                    hashes_in(v, hashes);
                }
            }
            _ => (),
        }
    }
    for row in &records {
        hashes_in(&row.value, &mut hashes);
    }
    for hash in hashes {
        if let Some(mut row) = get(&connection, scope, &format!("asset/{hash}"))? {
            let bytes = std::fs::read(asset_path(app, scope, &hash)?).map_err(|e| e.to_string())?;
            size += bytes.len() * 4 / 3;
            if size > 128 * 1024 * 1024 {
                return Err("笔记附件同步数据超过 128 MiB。".into());
            }
            if format!("{:x}", Sha256::digest(&bytes)) != hash {
                return Err("笔记附件校验失败。".into());
            }
            row.value["base64"] = Value::String(STANDARD.encode(bytes));
            records.push(row);
        }
    }
    records.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(
        serde_json::json!({"version":1,"scope":scope,"external":external,"category":category,"records":records}),
    )
}
fn sync_external_record(row: &ObjectRow, ids: &std::collections::HashSet<String>) -> bool {
    fn references_external(value: &Value, ids: &std::collections::HashSet<String>) -> bool {
        match value {
            Value::String(s) => {
                ids.contains(s) || s.starts_with("note-file-") || s.starts_with("liteasy://files/")
            }
            Value::Object(map) => {
                map.get("kind").and_then(Value::as_str) == Some("external-file")
                    || map.values().any(|v| references_external(v, ids))
            }
            Value::Array(items) => items.iter().any(|v| references_external(v, ids)),
            _ => false,
        }
    }
    row.key.contains("note-file-")
        || references_external(&row.value, ids)
        || ids
            .iter()
            .any(|id| row.key.split('/').any(|part| part == id))
}
pub(crate) fn sync_import(
    app: &AppHandle,
    scope: &str,
    value: &Value,
    previous: Option<&Value>,
) -> Result<(), String> {
    if value["version"] != 1 || value["scope"].as_str() != Some(scope) {
        return Err("笔记同步版本或账号不匹配。".into());
    }
    let category =
        value["category"]
            .as_str()
            .unwrap_or(if value["external"].as_bool() == Some(true) {
                "external"
            } else {
                "objects"
            });
    let admitted = |key: &str| {
        sync_record_category(key)
            == Some(if category == "external" {
                "objects"
            } else {
                category
            })
            || key.starts_with("asset/")
    };
    let mut rows: Vec<ObjectRow> =
        serde_json::from_value(value["records"].clone()).map_err(|_| "笔记同步格式无效")?;
    rows.retain(|row| admitted(&row.key));
    if rows.len() > 100_000 {
        return Err("笔记同步条目过多。".into());
    }
    let _guard = WRITE_LOCK.lock().map_err(|_| "对象存储忙碌")?;
    let mut connection = open(app, scope)?;
    let mut keys = std::collections::HashSet::new();
    for row in &mut rows {
        if row.key.is_empty()
            || row.key.len() > 2048
            || row.version.is_empty()
            || !keys.insert(row.key.clone())
        {
            return Err("笔记同步记录无效。".into());
        }
        if row.key.starts_with("head/") || row.key.starts_with("revision/") {
            if row.value["scopeId"].as_str() != Some(scope)
                || row.value["schemaVersion"] != "liteasy.object/v1"
                || row.value["objectId"].as_str() != row.key.split('/').nth(1)
                || (row.key.starts_with("revision/")
                    && row.value["revision"].as_str() != row.key.split('/').nth(2))
            {
                return Err("同步对象的账号、版本或身份无效。".into());
            }
        }
        if row.key.starts_with("asset/") {
            let hash = row.value["sha256"]
                .as_str()
                .ok_or("附件缺少校验值")?
                .to_owned();
            let bytes = STANDARD
                .decode(row.value["base64"].as_str().ok_or("附件内容缺失")?)
                .map_err(|_| "附件编码无效")?;
            if row.key != format!("asset/{hash}")
                || row.value["assetId"].as_str() != Some(hash.as_str())
                || crate::webdav::model::digest(&bytes) != hash
                || row.value["byteLength"].as_u64() != Some(bytes.len() as u64)
            {
                return Err("附件校验失败。".into());
            }
            crate::local_library::write_bytes_atomically(&asset_path(app, scope, &hash)?, &bytes)?;
            row.value
                .as_object_mut()
                .ok_or("附件格式无效")?
                .remove("base64");
        }
    }
    let mut previous_rows: Vec<ObjectRow> = previous
        .map(|v| serde_json::from_value(v["records"].clone()).map_err(|_| "旧笔记快照无效"))
        .transpose()?
        .unwrap_or_default();
    previous_rows.retain(|row| admitted(&row.key));
    sync_merge(&mut connection, scope, rows, &previous_rows)
}
fn sync_merge(
    connection: &mut Connection,
    scope: &str,
    rows: Vec<ObjectRow>,
    previous: &[ObjectRow],
) -> Result<(), String> {
    let keys: std::collections::HashSet<_> = rows.iter().map(|row| row.key.as_str()).collect();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    for row in previous {
        if !keys.contains(row.key.as_str())
            && !row.key.starts_with("revision/")
            && !row.key.starts_with("asset/")
            && !row.key.starts_with("extension-package/")
        {
            tx.execute(
                "DELETE FROM object_records WHERE scope=?1 AND key=?2",
                params![scope, row.key],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    // Retain immutable history and attachments; mutable records follow the selected snapshot.
    for row in rows {
        if row.key.starts_with("revision/") || row.key.starts_with("extension-package/") {
            if let Some(old) = get(&tx, scope, &row.key)? {
                if old.value != row.value || old.version != row.version {
                    return Err("不可变笔记版本冲突。".into());
                }
                continue;
            }
        }
        if row.key.starts_with("extension-package/") {
            if let Some(manifest) = row.value["files"]["liteasy.extension.json"]
                .as_str()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
            {
                if let (Some(id), Some(version)) =
                    (manifest["id"].as_str(), manifest["version"].as_str())
                {
                    if id.starts_with("plugin.")
                        && id.len() <= 80
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
                    {
                        let key = format!("extension-installation/{id}");
                        if get(&tx, scope, &key)?.is_none() {
                            let value = serde_json::json!({"schema":"liteasy.extension-installation/v1","id":id,"version":version,"digest":row.version,"enabled":false,"installedAt":"synced"});
                            tx.execute("INSERT INTO object_records(scope,key,version,value) VALUES(?1,?2,?3,?4)", params![scope,key,format!("synced-{}", row.version),value.to_string()]).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        }
        tx.execute("INSERT INTO object_records(scope,key,version,value) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,key) DO UPDATE SET version=excluded.version,value=excluded.value", params![scope,row.key,row.version,serde_json::to_string(&row.value).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Only old unreferenced files are reclaimed; active staging and committed attachments survive.
pub fn recover(app: &AppHandle) -> Result<(), String> {
    let scope = crate::desktop_identity::local_object_scope()?;
    let connection = open(app, &scope)?;
    let root = asset_path(app, &scope, &"0".repeat(64))?
        .parent()
        .ok_or("persistence_failed")?
        .to_path_buf();
    if !root.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file()
            || metadata
                .modified()
                .ok()
                .and_then(|time| time.elapsed().ok())
                .is_none_or(|age| age.as_secs() < 86400)
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".staging")
            || (name.len() == 64
                && name.bytes().all(|b| b.is_ascii_hexdigit())
                && get(&connection, &scope, &format!("asset/{name}"))?.is_none())
        {
            std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn create(key: &str) -> ObjectChange {
        ObjectChange {
            key: key.into(),
            expected: None,
            row: Some(ObjectRow {
                key: key.into(),
                version: "v1".into(),
                value: serde_json::json!({"text":"saved"}),
            }),
        }
    }
    #[test]
    fn sync_filters_linked_notes_and_merges_atomically_without_changing_revisions() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let row = |key: &str, version: &str, value: Value| ObjectRow {
            key: key.into(),
            version: version.into(),
            value,
        };
        let old = row(
            "revision/note/r1",
            "r1",
            serde_json::json!({"text":"original"}),
        );
        let edge = row(
            "edge/board/removed",
            "e1",
            serde_json::json!({"from":"note"}),
        );
        let external = row(
            "head/imported",
            "ext",
            serde_json::json!({"text":"external"}),
        );
        sync_merge(
            &mut db,
            "local",
            vec![old.clone(), edge.clone(), external.clone()],
            &[],
        )
        .unwrap();
        let bad = row(
            "revision/note/r1",
            "bad",
            serde_json::json!({"text":"rewritten"}),
        );
        assert!(sync_merge(&mut db, "local", vec![bad], std::slice::from_ref(&edge)).is_err());
        assert!(get(&db, "local", &edge.key).unwrap().is_some());
        sync_merge(
            &mut db,
            "local",
            vec![old.clone()],
            std::slice::from_ref(&edge),
        )
        .unwrap();
        assert!(get(&db, "local", &edge.key).unwrap().is_none());
        assert!(get(&db, "local", &external.key).unwrap().is_some());
        assert_eq!(
            get(&db, "local", &old.key).unwrap().unwrap().value,
            old.value
        );
        assert!(get(&db, "other", &old.key).unwrap().is_none());
        let ids = std::collections::HashSet::from(["imported".to_string()]);
        assert!(sync_external_record(&external, &ids));
        assert!(!sync_external_record(&old, &ids));
        assert!(sync_external_record(
            &row(
                "notes/reference/id/encoded",
                "v",
                serde_json::json!({"target":{"kind":"external-file","mountId":"vault","path":"private.md"}})
            ),
            &ids
        ));
    }
    #[test]
    fn extension_sync_never_transfers_activation_and_keeps_packages_immutable() {
        for prefix in [
            "extension-grant/",
            "extension-installation/",
            "extension-trigger/",
            "extension-trigger-event/",
            "extension-trial-data/",
        ] {
            assert_eq!(sync_record_category(&format!("{prefix}id")), None);
        }
        assert_eq!(
            sync_record_category("extension-package/plugin.example/1.0.0"),
            Some("extension-packages")
        );
        assert_eq!(
            sync_record_category("workflow-run/id"),
            Some("extension-runs")
        );
        assert_eq!(
            sync_record_category("workflow-snapshot/id/step"),
            Some("extension-snapshots")
        );
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let pkg = ObjectRow {
            key: "extension-package/plugin.example/1.0.0".into(),
            version: "digest".into(),
            value: serde_json::json!({"files":{"liteasy.extension.json": "{\"id\":\"plugin.example\",\"version\":\"1.0.0\"}"}}),
        };
        sync_merge(&mut db, "local", vec![pkg.clone()], &[]).unwrap();
        let installation = get(&db, "local", "extension-installation/plugin.example")
            .unwrap()
            .unwrap();
        assert_eq!(installation.value["enabled"], false);
        let mut corrupt = pkg.clone();
        corrupt.version = "changed".into();
        assert!(sync_merge(&mut db, "local", vec![corrupt], &[]).is_err());
        assert_eq!(
            get(&db, "local", &pkg.key).unwrap().unwrap().version,
            "digest"
        );
        sync_merge(&mut db, "local", vec![pkg], &[]).unwrap();
        assert_eq!(
            get(&db, "local", &installation.key)
                .unwrap()
                .unwrap()
                .version,
            installation.version
        );
    }
    #[test]
    fn conflict_rolls_back_all_records_and_scopes_are_isolated() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        commit(&mut db, "A", &[create("head/1")]).unwrap();
        assert!(
            commit(&mut db, "A", &[create("placement/1"), create("head/1")])
                .unwrap_err()
                .contains("revision_conflict")
        );
        assert!(get(&db, "A", "placement/1").unwrap().is_none());
        assert!(get(&db, "B", "head/1").unwrap().is_none());
        commit(&mut db, "B", &[create("head/1")]).unwrap();
    }
    #[test]
    fn revisions_are_immutable() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        commit(&mut db, "A", &[create("revision/1/v1")]).unwrap();
        let mut rewrite = create("revision/1/v1");
        rewrite.expected = Some("v1".into());
        assert!(commit(&mut db, "A", &[rewrite]).is_err());
    }
    #[test]
    fn full_database_rolls_back_the_entire_change_set() {
        let mut db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        commit(&mut db, "A", &[create("head/saved")]).unwrap();
        let pages: u64 = db
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .unwrap();
        db.execute_batch(&format!("PRAGMA max_page_count={pages}"))
            .unwrap();
        let mut large = create("revision/large/v1");
        large.row.as_mut().unwrap().value = serde_json::json!({"text": "x".repeat(1024 * 1024)});
        let error = commit(&mut db, "A", &[create("placement/new"), large]).unwrap_err();
        assert!(error.contains("full"), "{error}");
        assert!(get(&db, "A", "placement/new").unwrap().is_none());
        assert!(get(&db, "A", "revision/large/v1").unwrap().is_none());
        assert!(get(&db, "A", "head/saved").unwrap().is_some());
    }
    #[test]
    fn interrupted_process_recovers_only_committed_records() {
        const CHILD: &str = "LITEASY_OBJECT_CRASH_TEST_PATH";
        if let Ok(path) = std::env::var(CHILD) {
            let mut db = Connection::open(path).unwrap();
            initialize(&db).unwrap();
            commit(&mut db, "A", &[create("head/saved")]).unwrap();
            db.execute_batch("BEGIN IMMEDIATE; INSERT INTO object_records VALUES ('A','placement/interrupted','v1','{}');").unwrap();
            // Exit without SQLite/Rust destructors, emulating termination during a write.
            std::process::exit(73);
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "liteasy-object-crash-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("objects.sqlite3");
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "object_store::tests::interrupted_process_recovers_only_committed_records",
            ])
            .env(CHILD, &path)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73));
        {
            let db = Connection::open(&path).unwrap();
            initialize(&db).unwrap();
            assert!(get(&db, "A", "head/saved").unwrap().is_some());
            assert!(get(&db, "A", "placement/interrupted").unwrap().is_none());
            assert!(get(&db, "B", "head/saved").unwrap().is_none());
            assert_eq!(
                db.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                    .unwrap(),
                "ok"
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
