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
