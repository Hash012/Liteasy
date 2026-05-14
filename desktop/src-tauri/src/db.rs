use rusqlite::{Connection, Result as SqliteResult};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PaperRow {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub content: String,
    pub page_count: usize,
    pub imported_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteGroupRow {
    pub id: String,
    pub paper_id: String,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteRow {
    pub id: String,
    pub group_id: String,
    pub paper_id: String,
    pub selected_text: String,
    pub note_text: String,
    pub page_no: usize,
    pub bbox: Option<String>,
    pub color: String,
    pub created_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
    pub id: String,
    pub paper_id: Option<String>,
    pub mode: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub citation_refs: Option<String>,
    pub created_at: String,
}

#[derive(serde::Deserialize)]
struct MessagePayload {
    id: String,
    role: String,
    content: String,
    citation_refs: Option<String>,
    created_at: String,
}

fn map_note_row(row: &rusqlite::Row) -> rusqlite::Result<NoteRow> {
    Ok(NoteRow {
        id: row.get(0)?,
        group_id: row.get(1)?,
        paper_id: row.get(2)?,
        selected_text: row.get(3)?,
        note_text: row.get(4)?,
        page_no: row.get(5)?,
        bbox: row.get(6)?,
        color: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> SqliteResult<Self> {
        let db_path = Self::db_path();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Database { conn: Mutex::new(conn) };
        db.init_tables()?;
        Ok(db)
    }

    fn db_path() -> PathBuf {
        #[cfg(target_os = "linux")]
        {
            let base = std::env::var("XDG_DATA_HOME")
                .ok()
                .map(PathBuf::from)
                .or_else(|| {
                    std::env::var("HOME")
                        .ok()
                        .map(|h| PathBuf::from(h).join(".local/share"))
                })
                .unwrap_or_else(|| PathBuf::from("."));
            base.join("liteasy/data.db")
        }
        #[cfg(not(target_os = "linux"))]
        {
            let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
            base.join("liteasy/data.db")
        }
    }

    pub fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS papers (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                file_path TEXT NOT NULL,
                content TEXT,
                page_count INTEGER DEFAULT 0,
                imported_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS note_groups (
                id TEXT PRIMARY KEY,
                paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL REFERENCES note_groups(id) ON DELETE CASCADE,
                paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
                selected_text TEXT NOT NULL,
                note_text TEXT DEFAULT '',
                page_no INTEGER NOT NULL,
                bbox TEXT,
                color TEXT DEFAULT '#ffeb3b',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
                mode TEXT NOT NULL DEFAULT 'qa',
                title TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                citation_refs TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )?;
        Ok(())
    }

    pub fn save_paper(&self, id: &str, title: &str, file_path: &str,
        content: &str, page_count: usize, imported_at: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO papers (id, title, file_path, content, page_count, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title, content=excluded.content,
               page_count=excluded.page_count, file_path=excluded.file_path",
            rusqlite::params![id, title, file_path, content, page_count, imported_at],
        )?;
        Ok(())
    }

    pub fn load_papers(&self) -> SqliteResult<Vec<PaperRow>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, title, file_path, content, page_count, imported_at FROM papers ORDER BY imported_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PaperRow {
                id: row.get(0)?,
                title: row.get(1)?,
                file_path: row.get(2)?,
                content: row.get(3)?,
                page_count: row.get(4)?,
                imported_at: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_paper(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM papers WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn save_note_group(&self, id: &str, paper_id: &str, name: &str,
        sort_order: i32, created_at: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO note_groups (id, paper_id, name, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order",
            rusqlite::params![id, paper_id, name, sort_order, created_at],
        )?;
        Ok(())
    }

    pub fn load_note_groups(&self, paper_id: &str) -> SqliteResult<Vec<NoteGroupRow>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, paper_id, name, sort_order, created_at FROM note_groups
             WHERE paper_id = ?1 ORDER BY sort_order"
        )?;
        let rows = stmt.query_map(rusqlite::params![paper_id], |row| {
            Ok(NoteGroupRow {
                id: row.get(0)?,
                paper_id: row.get(1)?,
                name: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_note_group(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM note_groups WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn save_note(&self, id: &str, group_id: &str, paper_id: &str,
        selected_text: &str, note_text: &str, page_no: usize,
        bbox: Option<&str>, color: &str, created_at: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO notes (id, group_id, paper_id, selected_text, note_text,
             page_no, bbox, color, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               note_text=excluded.note_text, group_id=excluded.group_id,
               selected_text=excluded.selected_text, page_no=excluded.page_no,
               bbox=excluded.bbox, color=excluded.color",
            rusqlite::params![id, group_id, paper_id, selected_text, note_text,
              page_no, bbox, color, created_at],
        )?;
        Ok(())
    }

    pub fn load_notes(&self, paper_id: Option<&str>, group_id: Option<&str>) -> SqliteResult<Vec<NoteRow>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let sql = if let Some(_gid) = group_id {
            "SELECT id, group_id, paper_id, selected_text, note_text, page_no, bbox, color, created_at
             FROM notes WHERE group_id = ?1 ORDER BY created_at".to_string()
        } else if let Some(_pid) = paper_id {
            "SELECT id, group_id, paper_id, selected_text, note_text, page_no, bbox, color, created_at
             FROM notes WHERE paper_id = ?1 ORDER BY created_at".to_string()
        } else {
            "SELECT id, group_id, paper_id, selected_text, note_text, page_no, bbox, color, created_at
             FROM notes ORDER BY created_at".to_string()
        };
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<NoteRow> = if let Some(gid) = group_id {
            stmt.query_map(rusqlite::params![gid], map_note_row)?.collect::<SqliteResult<Vec<_>>>()?
        } else if let Some(pid) = paper_id {
            stmt.query_map(rusqlite::params![pid], map_note_row)?.collect::<SqliteResult<Vec<_>>>()?
        } else {
            stmt.query_map([], map_note_row)?.collect::<SqliteResult<Vec<_>>>()?
        };
        Ok(rows)
    }

    pub fn delete_note(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn load_all_notes(&self) -> SqliteResult<Vec<NoteRow>> {
        self.load_notes(None, None)
    }

    pub fn save_conversation(&self, id: &str, paper_id: Option<&str>,
        mode: &str, title: &str, created_at: &str, messages_json: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let msgs: Vec<MessagePayload> = serde_json::from_str(messages_json)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        conn.execute(
            "INSERT INTO conversations (id, paper_id, mode, title, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title",
            rusqlite::params![id, paper_id, mode, title, created_at],
        )?;
        for m in msgs {
            conn.execute(
                "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, citation_refs, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![m.id, id, m.role, m.content, m.citation_refs, m.created_at],
            )?;
        }
        Ok(())
    }

    pub fn load_conversations(&self, paper_id: Option<&str>) -> SqliteResult<Vec<ConversationRow>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let sql = if paper_id.is_some() {
            "SELECT id, paper_id, mode, title, created_at FROM conversations WHERE paper_id = ?1 ORDER BY created_at DESC"
        } else {
            "SELECT id, paper_id, mode, title, created_at FROM conversations ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows: Vec<ConversationRow> = if let Some(pid) = paper_id {
            stmt.query_map(rusqlite::params![pid], |row| Ok(ConversationRow {
                id: row.get(0)?, paper_id: row.get(1)?, mode: row.get(2)?,
                title: row.get(3)?, created_at: row.get(4)?,
            }))?.collect::<SqliteResult<Vec<_>>>()?
        } else {
            stmt.query_map([], |row| Ok(ConversationRow {
                id: row.get(0)?, paper_id: row.get(1)?, mode: row.get(2)?,
                title: row.get(3)?, created_at: row.get(4)?,
            }))?.collect::<SqliteResult<Vec<_>>>()?
        };
        Ok(rows)
    }

    pub fn load_messages(&self, conversation_id: &str) -> SqliteResult<Vec<MessageRow>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, citation_refs, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at"
        )?;
        let rows = stmt.query_map(rusqlite::params![conversation_id], |row| Ok(MessageRow {
            id: row.get(0)?, conversation_id: row.get(1)?, role: row.get(2)?,
            content: row.get(3)?, citation_refs: row.get(4)?, created_at: row.get(5)?,
        }))?.collect::<SqliteResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn save_setting(&self, key: &str, value: &str, updated_at: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            rusqlite::params![key, value, updated_at],
        )?;
        Ok(())
    }

    pub fn load_settings(&self) -> SqliteResult<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<SqliteResult<Vec<_>>>()?;
        Ok(rows)
    }
}
