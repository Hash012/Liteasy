//! Rebuildable, account/workspace/model-partitioned retrieval cache, never an asset store.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, Once,
};
#[derive(Default)]
pub struct SemanticIndexState(Mutex<HashMap<String, Arc<AtomicBool>>>);
use tauri::AppHandle;

static REGISTER: Once = Once::new();
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRecord {
    id: String,
    path: String,
    revision: String,
    text: String,
    tokens: String,
    #[serde(default)]
    vector: Option<Vec<f32>>,
    #[serde(default)]
    payload: Option<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRequest {
    scope: String,
    workspace: String,
    model: String,
    action: String,
    #[serde(default)]
    records: Vec<IndexRecord>,
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    text: String,
    vector: Option<Vec<f32>>,
    limit: Option<usize>,
    #[serde(default)]
    clauses: Vec<String>,
    group: Option<String>,
    offset: Option<usize>,
}
fn initialize(db: &Connection) -> rusqlite::Result<()> {
    REGISTER.call_once(|| unsafe {
        // sqlite-vec is statically linked; no filesystem extension loading is enabled.
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::ffi::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> std::ffi::c_int,
        >(
            sqlite_vec::sqlite3_vec_init as *const ()
        )));
    });
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA cache_size=-8192;
        CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, path TEXT NOT NULL, revision TEXT NOT NULL, text TEXT NOT NULL, vector BLOB, dimension INTEGER, payload TEXT, updated INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS entries_path ON entries(path);
        CREATE VIRTUAL TABLE IF NOT EXISTS words USING fts5(tokens);
        CREATE VIRTUAL TABLE IF NOT EXISTS literal_words USING fts5(text, tokenize='trigram');
        CREATE TRIGGER IF NOT EXISTS entries_literal_delete AFTER DELETE ON entries BEGIN
          DELETE FROM literal_words WHERE rowid=old.rowid;
        END;
        PRAGMA user_version=1;")
}
fn open_db(path: &std::path::Path) -> Result<Connection, String> {
    // Register BEFORE opening the connection so SQLite installs the functions.
    REGISTER.call_once(|| unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::ffi::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> std::ffi::c_int,
        >(
            sqlite_vec::sqlite3_vec_init as *const ()
        )));
    });
    let db = Connection::open(path).map_err(|_| "本地检索缓存不可用，可在设置中清除重建。")?;
    let version: u32 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| "检索缓存版本无法读取。")?;
    if version > 1 {
        return Err("检索缓存来自更新版本，已保留；当前使用词项检索。".into());
    }
    initialize(&db).map_err(|_| "检索缓存初始化失败，当前使用词项检索。")?;
    Ok(db)
}
fn vector_bytes(vector: &[f32]) -> Result<Vec<u8>, String> {
    if vector.is_empty()
        || vector.len() > 4096
        || vector.iter().any(|n| !n.is_finite())
        || vector.iter().all(|n| *n == 0.0)
    {
        return Err("向量维度或内容无效。".into());
    }
    Ok(vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect())
}
fn execute(db: &mut Connection, input: IndexRequest) -> Result<Value, String> {
    let fail = |_| "检索缓存操作失败，可清除后重建。".to_string();
    match input.action.as_str() {
        "lookup" => {
            if input.ids.len() > 64 {
                return Err("单次最多读取 64 条缓存。".into());
            }
            let mut found = Vec::new();
            for id in input.ids {
                let row = db.query_row("SELECT id,path,revision,text,vector,payload FROM entries WHERE id=?1", [&id], |row| {
                    let bytes: Option<Vec<u8>> = row.get(4)?;
                    let vector: Option<Vec<f32>> = bytes.map(|bytes| bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0],b[1],b[2],b[3]])).collect());
                    let payload: Option<String> = row.get(5)?;
                    Ok(json!({ "id": row.get::<_,String>(0)?, "path":row.get::<_,String>(1)?, "revision":row.get::<_,String>(2)?, "text":row.get::<_,String>(3)?, "vector":vector, "payload":payload.and_then(|s| serde_json::from_str::<Value>(&s).ok()) }))
                }).optional().map_err(fail)?;
                if let Some(row) = row {
                    found.push(row);
                }
            }
            Ok(json!(found))
        }
        "upsert" => {
            if input.records.len() > 32 {
                return Err("单次最多写入 32 条检索缓存。".into());
            }
            let tx = db.transaction().map_err(fail)?;
            for record in input.records {
                if record.id.len() > 1024
                    || record.path.len() > 8192
                    || record.revision.len() > 1024
                    || record.text.len() > 64000
                    || record.tokens.len() > 96000
                    || record
                        .payload
                        .as_ref()
                        .is_some_and(|v| v.to_string().len() > 64000)
                {
                    return Err("检索片段过大。".into());
                }
                let vector = record.vector.as_deref().map(vector_bytes).transpose()?;
                let dimension = record.vector.as_ref().map(Vec::len);
                tx.execute("DELETE FROM words WHERE rowid IN (SELECT rowid FROM entries WHERE id=?1 OR (path=?2 AND revision<>?3))", params![record.id, record.path, record.revision]).map_err(fail)?;
                tx.execute(
                    "DELETE FROM entries WHERE id=?1 OR (path=?2 AND revision<>?3)",
                    params![record.id, record.path, record.revision],
                )
                .map_err(fail)?;
                tx.execute("INSERT INTO entries(id,path,revision,text,vector,dimension,payload,updated) VALUES(?1,?2,?3,?4,?5,?6,?7,unixepoch())", params![record.id,record.path,record.revision,record.text,vector,dimension,record.payload.map(|v|v.to_string())]).map_err(fail)?;
                let rowid = tx.last_insert_rowid();
                tx.execute(
                    "INSERT INTO literal_words(rowid,text) VALUES(?1,?2)",
                    params![rowid, record.text.to_lowercase()],
                )
                .map_err(fail)?;
                tx.execute(
                    "INSERT INTO words(rowid,tokens) VALUES(?1,?2)",
                    params![rowid, record.tokens],
                )
                .map_err(fail)?;
            }
            // LRU bound on derived snippets; removing a cache entry never removes an asset.
            tx.execute("DELETE FROM words WHERE rowid IN (SELECT rowid FROM entries ORDER BY updated DESC,rowid DESC LIMIT -1 OFFSET 50000)", []).map_err(fail)?;
            tx.execute("DELETE FROM entries WHERE rowid IN (SELECT rowid FROM entries ORDER BY updated DESC,rowid DESC LIMIT -1 OFFSET 50000)", []).map_err(fail)?;
            tx.commit().map_err(fail)?;
            Ok(json!({"ok":true}))
        }
        "literal_query" => {
            if input.clauses.is_empty()
                || input.clauses.len() > 16
                || input.clauses.iter().any(|v| v.is_empty() || v.len() > 1024)
            {
                return Err("请输入最多 16 个检索词或引号短语。".into());
            }
            let clauses: Vec<String> = input.clauses.iter().map(|v| v.to_lowercase()).collect();
            let coarse = clauses
                .iter()
                .filter(|v| v.chars().count() >= 3)
                .map(|v| format!("\"{}\"", v.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" AND ");
            let mut conditions = Vec::new();
            let mut values = Vec::<rusqlite::types::Value>::new();
            if !coarse.is_empty() {
                conditions.push("literal_words MATCH ?".to_string());
                values.push(coarse.into());
            }
            // Exact substring checks retain two-character terms and literal punctuation;
            // FTS only narrows candidates. All strings are bound parameters, never SQL.
            for clause in clauses {
                conditions.push("instr(l.text, ?) > 0".into());
                values.push(clause.into());
            }
            if let Some(group) = input.group {
                conditions.push("json_extract(e.payload, '$.group') = ?".into());
                values.push(group.into());
            }
            let from = format!(
                "FROM literal_words l JOIN entries e ON e.rowid=l.rowid WHERE {}",
                conditions.join(" AND ")
            );
            let total: usize = db
                .query_row(
                    &format!("SELECT count(*) {from}"),
                    rusqlite::params_from_iter(values.iter()),
                    |row| row.get(0),
                )
                .map_err(fail)?;
            let limit = input.limit.unwrap_or(20).clamp(1, 100);
            let offset = input.offset.unwrap_or(0).min(50000);
            values.push((limit as i64).into());
            values.push((offset as i64).into());
            let mut statement = db.prepare(&format!("SELECT e.id,e.path,e.revision,e.text,e.payload {from} ORDER BY e.path,e.id LIMIT ? OFFSET ?")).map_err(fail)?;
            let rows = statement.query_map(rusqlite::params_from_iter(values.iter()), |row| Ok(json!({
                "id":row.get::<_,String>(0)?, "path":row.get::<_,String>(1)?, "revision":row.get::<_,String>(2)?,
                "text":row.get::<_,String>(3)?, "payload":row.get::<_,Option<String>>(4)?.and_then(|v|serde_json::from_str::<Value>(&v).ok())
            }))).map_err(fail)?;
            let hits = rows.collect::<Result<Vec<_>, _>>().map_err(fail)?;
            Ok(
                json!({"hits":hits,"total":total,"nextOffset":if offset+limit<total {Some(offset+limit)} else {None}}),
            )
        }
        "search" => {
            let limit = input.limit.unwrap_or(100).clamp(1, 200);
            let mut hits = Vec::new();
            let query = input
                .text
                .split_whitespace()
                .take(64)
                .map(|word| format!("\"{}\"", word.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(" OR ");
            if !query.is_empty() {
                let mut statement = db.prepare("SELECT e.id,e.path,e.payload,-bm25(words) FROM words JOIN entries e ON words.rowid=e.rowid WHERE words MATCH ?1 ORDER BY bm25(words) LIMIT ?2").map_err(fail)?;
                let rows = statement.query_map(params![query,limit], |row| Ok(json!({"id":row.get::<_,String>(0)?,"path":row.get::<_,String>(1)?,"payload":row.get::<_,Option<String>>(2)?.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"lexical":row.get::<_,f64>(3)?}))).map_err(fail)?;
                for row in rows {
                    hits.push(row.map_err(fail)?);
                }
            }
            if let Some(vector) = input.vector {
                let bytes = vector_bytes(&vector)?;
                let mut statement = db.prepare("SELECT id,path,payload,1.0-vec_distance_cosine(vector,?1) AS similarity FROM entries WHERE dimension=?2 ORDER BY similarity DESC LIMIT ?3").map_err(fail)?;
                let rows = statement.query_map(params![bytes,vector.len(),limit], |row| Ok(json!({"id":row.get::<_,String>(0)?,"path":row.get::<_,String>(1)?,"payload":row.get::<_,Option<String>>(2)?.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"semantic":row.get::<_,f64>(3)?}))).map_err(fail)?;
                for row in rows {
                    hits.push(row.map_err(fail)?);
                }
            }
            Ok(json!(hits))
        }
        "delete" => {
            if input.ids.len() > 200 {
                return Err("清理条目过多。".into());
            }
            let tx = db.transaction().map_err(fail)?;
            for path in input.ids {
                tx.execute(
                    "DELETE FROM words WHERE rowid IN (SELECT rowid FROM entries WHERE path=?1)",
                    [&path],
                )
                .map_err(fail)?;
                tx.execute("DELETE FROM entries WHERE path=?1", [&path])
                    .map_err(fail)?;
            }
            tx.commit().map_err(fail)?;
            Ok(json!({"ok":true}))
        }
        "clear" => {
            db.execute_batch("DELETE FROM words; DELETE FROM entries;")
                .map_err(fail)?;
            Ok(json!({"ok":true}))
        }
        _ => Err("检索操作无效。".into()),
    }
}
#[tauri::command]
pub async fn semantic_index_dispatch(
    app: AppHandle,
    state: tauri::State<'_, SemanticIndexState>,
    request_id: String,
    input: IndexRequest,
) -> Result<Value, String> {
    if input.scope != crate::desktop_identity::local_object_scope()?
        || input.workspace.len() > 8192
        || input.model.len() > 4096
    {
        return Err("检索缓存不属于当前工作区。".into());
    }
    let directory = crate::data_location::root(&app)?
        .join("cache")
        .join("semantic-index")
        .join(format!("{:x}", Sha256::digest(input.scope.as_bytes())));
    std::fs::create_dir_all(&directory).map_err(|_| "无法建立检索缓存。")?;
    let name = format!(
        "{:x}.sqlite3",
        Sha256::digest(
            serde_json::to_vec(&(&input.scope, &input.workspace, &input.model))
                .map_err(|_| "检索参数无效。")?
        )
    );
    let canceled = Arc::new(AtomicBool::new(false));
    {
        let mut tasks = state.0.lock().map_err(|_| "索引队列不可用。")?;
        if request_id.len() > 100 || tasks.len() >= 8 || tasks.contains_key(&request_id) {
            return Err("索引队列已满，请稍后重试。".into());
        }
        tasks.insert(request_id.clone(), canceled.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        if canceled.load(Ordering::Relaxed) {
            return Err("索引任务已取消。".into());
        }
        let mut db = open_db(&directory.join(name))?;
        db.progress_handler(1000, Some(move || canceled.load(Ordering::Relaxed)));
        execute(&mut db, input)
    })
    .await
    .map_err(|_| "检索任务中断。");
    if let Ok(mut tasks) = state.0.lock() {
        tasks.remove(&request_id);
    }
    result?
}
#[tauri::command]
pub fn semantic_index_cancel(state: tauri::State<'_, SemanticIndexState>, request_id: String) {
    if let Ok(tasks) = state.0.lock() {
        if let Some(flag) = tasks.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(action: &str) -> IndexRequest {
        IndexRequest {
            scope: "local".into(),
            workspace: "test".into(),
            model: "v1".into(),
            action: action.into(),
            records: vec![],
            ids: vec![],
            text: String::new(),
            vector: None,
            limit: None,
            clauses: vec![],
            group: None,
            offset: None,
        }
    }
    #[test]
    fn literal_query_filters_phrases_group_and_short_unicode_before_pagination() {
        let mut db = open_db(std::path::Path::new(":memory:")).unwrap();
        for i in 0..45 {
            let mut write = request("upsert");
            write.records.push(IndexRecord {
                id: format!("{i:03}"),
                path: format!("note:{i:03}"),
                revision: "1".into(),
                text: "研究 Concurrent Transactions Éclair".into(),
                tokens: "".into(),
                vector: None,
                payload: Some(json!({"group":"note"})),
            });
            execute(&mut db, write).unwrap();
        }
        let mut query = request("literal_query");
        query.clauses = vec![
            "研究".into(),
            "concurrent transactions".into(),
            "éclair".into(),
        ];
        query.group = Some("note".into());
        query.limit = Some(20);
        query.offset = Some(20);
        let result = execute(&mut db, query).unwrap();
        assert_eq!(result["total"], 45);
        assert_eq!(result["hits"].as_array().unwrap().len(), 20);
        assert_eq!(result["hits"][0]["id"], "020");
        assert_eq!(result["nextOffset"], 40);
        let mut query = request("literal_query");
        query.clauses = vec!["transactions concurrent".into()];
        assert_eq!(execute(&mut db, query).unwrap()["total"], 0);
        let mut delete = request("delete");
        delete.ids = vec!["note:020".into()];
        execute(&mut db, delete).unwrap();
        let mut query = request("literal_query");
        query.clauses = vec!["研究".into()];
        assert_eq!(execute(&mut db, query).unwrap()["total"], 44);
        let mut query = request("literal_query");
        query.clauses = vec!["研究".into()];
        query.group = Some("annotation".into());
        assert_eq!(execute(&mut db, query).unwrap()["total"], 0);
    }
    #[test]
    fn fts_vectors_revisions_and_deletion_share_one_transaction() {
        let mut db = open_db(std::path::Path::new(":memory:")).unwrap();
        let mut write = request("upsert");
        write.records.push(IndexRecord {
            id: "paper-r1".into(),
            path: "liteasy://paper".into(),
            revision: "1".into(),
            text: "Transactions".into(),
            tokens: "database transaction concurrency".into(),
            vector: Some(vec![1., 0., 0.]),
            payload: None,
        });
        execute(&mut db, write).unwrap();
        let mut search = request("search");
        search.text = "transaction".into();
        search.vector = Some(vec![1., 0., 0.]);
        let hits = execute(&mut db, search).unwrap();
        assert_eq!(hits.as_array().unwrap().len(), 2);
        assert_eq!(hits[1]["semantic"].as_f64(), Some(1.));
        let mut write = request("upsert");
        write.records.push(IndexRecord {
            id: "paper-r2".into(),
            path: "liteasy://paper".into(),
            revision: "2".into(),
            text: "Memory".into(),
            tokens: "episodic memory".into(),
            vector: None,
            payload: None,
        });
        execute(&mut db, write).unwrap();
        let mut search = request("search");
        search.text = "transaction".into();
        assert_eq!(execute(&mut db, search).unwrap(), json!([]));
        let mut delete = request("delete");
        delete.ids.push("liteasy://paper".into());
        execute(&mut db, delete).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM entries", [], |row| row
                .get::<_, usize>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn invalid_vectors_rollback_and_future_cache_versions_are_not_overwritten() {
        let path = std::env::temp_dir().join(format!(
            "liteasy-index-{}.sqlite3",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let future = Connection::open(&path).unwrap();
        future.pragma_update(None, "user_version", 99).unwrap();
        drop(future);
        assert!(open_db(&path).is_err());
        let future = Connection::open(&path).unwrap();
        assert_eq!(
            future
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            99
        );
        drop(future);
        let _ = std::fs::remove_file(path);
        assert!(vector_bytes(&[f32::NAN]).is_err());
        assert!(vector_bytes(&[0., 0.]).is_err());
        let mut db = open_db(std::path::Path::new(":memory:")).unwrap();
        let mut write = request("upsert");
        write.records.push(IndexRecord {
            id: "bad".into(),
            path: "p".into(),
            revision: "1".into(),
            text: "".into(),
            tokens: "".into(),
            vector: Some(vec![f32::INFINITY]),
            payload: None,
        });
        assert!(execute(&mut db, write).is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM entries", [], |r| r.get::<_, usize>(0))
                .unwrap(),
            0
        );
    }
}

#[tauri::command]
pub async fn request_semantic_service(
    state: tauri::State<'_, crate::paper_fulltext::FullTextState>,
    request_id: String,
    config: crate::paper_services::PaperServiceConfig,
    body: String,
) -> Result<crate::paper_services::ServiceResponse, String> {
    if request_id.len() > 100
        || body.len() > 512 * 1024
        || !matches!(config.provider.as_str(), "embedding" | "reranker")
    {
        return Err("语义服务请求无效。".into());
    }
    let suffix = if config.provider == "embedding" {
        "embeddings"
    } else {
        "rerank"
    };
    let url = format!("{}/{suffix}", config.endpoint.trim_end_matches('/'));
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let mut requests = state.requests.lock().map_err(|_| "语义服务状态不可用。")?;
        if requests.len() >= 8 || requests.contains_key(&request_id) {
            return Err("语义服务任务过多。".into());
        }
        requests.insert(
            request_id.clone(),
            tauri::async_runtime::spawn(async move {
                use base64::Engine;
                let result = crate::paper_services::request_paper_service(
                    config,
                    url,
                    "POST".into(),
                    Some(base64::engine::general_purpose::STANDARD.encode(body)),
                    Some("application/json".into()),
                    true,
                    Some(8 * 1024 * 1024),
                    Some(30000),
                    Some(false),
                )
                .await;
                let _ = sender.send(result);
            }),
        );
    }
    let result = receiver
        .await
        .unwrap_or_else(|_| Err("语义服务请求已取消。".into()));
    if let Ok(mut requests) = state.requests.lock() {
        requests.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn semantic_index_clear_scope(app: AppHandle, scope: String) -> Result<(), String> {
    if scope != crate::desktop_identity::local_object_scope()? {
        return Err("检索缓存不属于当前账户。".into());
    }
    let path = crate::data_location::root(&app)?
        .join("cache")
        .join("semantic-index")
        .join(format!("{:x}", Sha256::digest(scope.as_bytes())));
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|_| "缓存仍在使用，请停止推荐更新后重试。")?;
    }
    Ok(())
}

#[cfg(test)]
mod benchmark;
