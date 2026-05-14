# Liteasy 持久化存储与阅读批注系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite persistence layer, replace text-only PDF reader with PDF.js rendering, and add annotation system with floating toolbar and hierarchical notes panel.

**Architecture:** Rust backend gains rusqlite for local SQLite storage and exposes db_* Tauri commands. Frontend ReaderPane is rewritten to use PDF.js for full-fidelity PDF rendering with text selection. New NotesPanel provides Paper → Group → Note hierarchy. Existing in-memory stores are modified to load from and persist to SQLite.

**Tech Stack:** Tauri 2, React 18, TypeScript, Rust, rusqlite (bundled), pdfjs-dist, Vite, Vitest

---

### Task 1: Rust SQLite database layer

**Files:**
- Create: `desktop/src-tauri/src/db.rs`

- [ ] **Step 1: Create db.rs with connection manager and schema init**

```rust
use rusqlite::{Connection, Result as SqliteResult};
use std::path::PathBuf;
use std::sync::Mutex;

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
        let base = dirs_next().unwrap_or_else(|| PathBuf::from("."));
        base.join(".local/share/liteasy/data.db")
    }

    fn dirs_next() -> Option<PathBuf> {
        #[cfg(target_os = "linux")]
        {
            std::env::var("XDG_DATA_HOME")
                .ok()
                .map(PathBuf::from)
                .or_else(|| {
                    std::env::var("HOME")
                        .ok()
                        .map(|h| PathBuf::from(h).join(".local/share"))
                })
        }
        #[cfg(not(target_os = "linux"))]
        {
            dirs::data_local_dir()
        }
    }

    fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
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
}
```

- [ ] **Step 2: Add paper CRUD functions to db.rs**

Append to `impl Database` block:

```rust
pub fn save_paper(&self, id: &str, title: &str, file_path: &str,
    content: &str, page_count: usize, imported_at: &str) -> SqliteResult<()> {
    let conn = self.conn.lock().unwrap();
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
    let conn = self.conn.lock().unwrap();
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
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM papers WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}
```

- [ ] **Step 3: Add struct definitions at top of db.rs (before impl Database)**

```rust
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct PaperRow {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub content: String,
    pub page_count: usize,
    pub imported_at: String,
}

#[derive(Serialize, Debug)]
pub struct NoteGroupRow {
    pub id: String,
    pub paper_id: String,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Serialize, Debug)]
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
pub struct ConversationRow {
    pub id: String,
    pub paper_id: Option<String>,
    pub mode: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Serialize, Debug)]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub citation_refs: Option<String>,
    pub created_at: String,
}
```

- [ ] **Step 4: Add note_groups and notes CRUD functions to db.rs**

Append to `impl Database`:

```rust
pub fn save_note_group(&self, id: &str, paper_id: &str, name: &str,
    sort_order: i32, created_at: &str) -> SqliteResult<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO note_groups (id, paper_id, name, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order",
        rusqlite::params![id, paper_id, name, sort_order, created_at],
    )?;
    Ok(())
}

pub fn load_note_groups(&self, paper_id: &str) -> SqliteResult<Vec<NoteGroupRow>> {
    let conn = self.conn.lock().unwrap();
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
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM note_groups WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn save_note(&self, id: &str, group_id: &str, paper_id: &str,
    selected_text: &str, note_text: &str, page_no: usize,
    bbox: Option<&str>, color: &str, created_at: &str) -> SqliteResult<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO notes (id, group_id, paper_id, selected_text, note_text,
         page_no, bbox, color, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           note_text=excluded.note_text, group_id=excluded.group_id",
        rusqlite::params![id, group_id, paper_id, selected_text, note_text,
          page_no, bbox, color, created_at],
    )?;
    Ok(())
}

pub fn load_notes(&self, paper_id: Option<&str>, group_id: Option<&str>) -> SqliteResult<Vec<NoteRow>> {
    let conn = self.conn.lock().unwrap();
    let sql = if let Some(gid) = group_id {
        "SELECT id, group_id, paper_id, selected_text, note_text, page_no, bbox, color, created_at
         FROM notes WHERE group_id = ?1 ORDER BY created_at".to_string()
    } else if let Some(pid) = paper_id {
        "SELECT id, group_id, paper_id, selected_text, note_text, page_no, bbox, color, created_at
         FROM notes WHERE paper_id = ?1 ORDER BY created_at".to_string()
    } else {
        "SELECT id, group_id, paper_id, selected_text, note_text, page_no, bbox, color, created_at
         FROM notes ORDER BY created_at".to_string()
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(gid) = group_id {
        stmt.query_map(rusqlite::params![gid], map_note_row)?
    } else if let Some(pid) = paper_id {
        stmt.query_map(rusqlite::params![pid], map_note_row)?
    } else {
        stmt.query_map([], map_note_row)?
    };
    rows.collect()
}

pub fn delete_note(&self, id: &str) -> SqliteResult<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn load_all_notes(&self) -> SqliteResult<Vec<NoteRow>> {
    self.load_notes(None, None)
}
```

- [ ] **Step 5: Add helper for note row mapping (above impl Database)**

```rust
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
```

- [ ] **Step 6: Add conversation + message CRUD to db.rs**

```rust
pub fn save_conversation(&self, id: &str, paper_id: Option<&str>,
    mode: &str, title: &str, created_at: &str, messages_json: &str) -> SqliteResult<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO conversations (id, paper_id, mode, title, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title",
        rusqlite::params![id, paper_id, mode, title, created_at],
    )?;
    if let Ok(msgs) = serde_json::from_str::<Vec<MessagePayload>>(messages_json) {
        for m in msgs {
            conn.execute(
                "INSERT OR REPLACE INTO messages (id, conversation_id, role, content, citation_refs, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![m.id, id, m.role, m.content, m.citation_refs, m.created_at],
            )?;
        }
    }
    Ok(())
}

pub fn load_conversations(&self, paper_id: Option<&str>) -> SqliteResult<Vec<ConversationRow>> {
    let conn = self.conn.lock().unwrap();
    let sql = if paper_id.is_some() {
        "SELECT id, paper_id, mode, title, created_at FROM conversations WHERE paper_id = ?1 ORDER BY created_at DESC"
    } else {
        "SELECT id, paper_id, mode, title, created_at FROM conversations ORDER BY created_at DESC"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = if let Some(pid) = paper_id {
        stmt.query_map(rusqlite::params![pid], |row| Ok(ConversationRow {
            id: row.get(0)?, paper_id: row.get(1)?, mode: row.get(2)?,
            title: row.get(3)?, created_at: row.get(4)?,
        }))?
    } else {
        stmt.query_map([], |row| Ok(ConversationRow {
            id: row.get(0)?, paper_id: row.get(1)?, mode: row.get(2)?,
            title: row.get(3)?, created_at: row.get(4)?,
        }))?
    };
    rows.collect()
}

pub fn load_messages(&self, conversation_id: &str) -> SqliteResult<Vec<MessageRow>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, citation_refs, created_at
         FROM messages WHERE conversation_id = ?1 ORDER BY created_at"
    )?;
    let rows = stmt.query_map(rusqlite::params![conversation_id], |row| Ok(MessageRow {
        id: row.get(0)?, conversation_id: row.get(1)?, role: row.get(2)?,
        content: row.get(3)?, citation_refs: row.get(4)?, created_at: row.get(5)?,
    }))?;
    rows.collect()
}
```

- [ ] **Step 7: Add MessagePayload struct and settings CRUD to db.rs**

```rust
#[derive(serde::Deserialize)]
struct MessagePayload {
    id: String,
    role: String,
    content: String,
    citation_refs: Option<String>,
    created_at: String,
}

// Inside impl Database:
pub fn save_setting(&self, key: &str, value: &str, updated_at: &str) -> SqliteResult<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        rusqlite::params![key, value, updated_at],
    )?;
    Ok(())
}

pub fn load_settings(&self) -> SqliteResult<Vec<(String, String)>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}
```

- [ ] **Step 8: Compile db.rs to check for syntax errors**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop/src-tauri && cargo check 2>&1 | tail -20`
Expected: Compilation errors about missing `rusqlite` and `serde_json` (added in next task)

---

### Task 2: Rust Cargo.toml and main.rs wiring

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Add rusqlite and serde_json dependencies to Cargo.toml**

Read the file first, then edit. Current `[dependencies]` section:

```toml
[dependencies]
pdf-extract = "0.9"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2.5.1", features = [] }
tauri-plugin-dialog = "2"
```

Change to:

```toml
[dependencies]
pdf-extract = "0.9"
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2.5.1", features = [] }
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Rewrite main.rs to register Database as Tauri state and expose all db_* commands**

Replace the entire content of `main.rs` with:

```rust
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod db;

use db::Database;
use pdf_extract::extract_text;
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::State;

#[derive(Serialize)]
struct PdfImportResult {
    job_id: String,
    status: String,
    title: String,
    content: String,
    page_count: usize,
    file_path: String,
}

#[tauri::command]
fn import_pdf(path: String) -> Result<PdfImportResult, String> {
    let job_id = format!(
        "job-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    if file_path.extension().and_then(|e| e.to_str()) != Some("pdf") {
        return Err(format!("不支持的文件类型，仅接受 PDF: {}", path));
    }

    let content = extract_text(&path).map_err(|e| format!("PDF 文本提取失败: {}", e))?;

    let title = content
        .lines()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().chars().take(120).collect())
        .unwrap_or_else(|| {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("未命名文献")
                .to_string()
        });

    let raw_bytes = fs::read(&path).map_err(|e| format!("无法读取文件: {}", e))?;
    let raw_str = String::from_utf8_lossy(&raw_bytes);
    let page_count = count_pdf_pages(&raw_str);

    Ok(PdfImportResult {
        job_id,
        status: "parsed".into(),
        title,
        content,
        page_count,
        file_path: path,
    })
}

fn count_pdf_pages(raw: &str) -> usize {
    let mut count = 0;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed == "/Type /Page" || trimmed == "/Type/Page" {
            count += 1;
        }
    }
    if count == 0 { 1 } else { count }
}

// ── DB commands ──

#[tauri::command]
fn db_init(state: State<Database>) -> Result<String, String> {
    state.init_tables().map_err(|e| e.to_string())?;
    Ok("ok".into())
}

#[tauri::command]
fn db_save_paper(state: State<Database>, id: String, title: String, file_path: String,
    content: String, page_count: usize, imported_at: String) -> Result<(), String> {
    state.save_paper(&id, &title, &file_path, &content, page_count, &imported_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_papers(state: State<Database>) -> Result<Vec<db::PaperRow>, String> {
    state.load_papers().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_paper(state: State<Database>, id: String) -> Result<(), String> {
    state.delete_paper(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_note_group(state: State<Database>, id: String, paper_id: String,
    name: String, sort_order: i32, created_at: String) -> Result<(), String> {
    state.save_note_group(&id, &paper_id, &name, sort_order, &created_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_note_groups(state: State<Database>, paper_id: String) -> Result<Vec<db::NoteGroupRow>, String> {
    state.load_note_groups(&paper_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_note_group(state: State<Database>, id: String) -> Result<(), String> {
    state.delete_note_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_note(state: State<Database>, id: String, group_id: String,
    paper_id: String, selected_text: String, note_text: String,
    page_no: usize, bbox: Option<String>, color: String,
    created_at: String) -> Result<(), String> {
    state.save_note(&id, &group_id, &paper_id, &selected_text, &note_text,
        page_no, bbox.as_deref(), &color, &created_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_notes(state: State<Database>, paper_id: Option<String>,
    group_id: Option<String>) -> Result<Vec<db::NoteRow>, String> {
    state.load_notes(paper_id.as_deref(), group_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_note(state: State<Database>, id: String) -> Result<(), String> {
    state.delete_note(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_conversation(state: State<Database>, id: String,
    paper_id: Option<String>, mode: String, title: String,
    created_at: String, messages_json: String) -> Result<(), String> {
    state.save_conversation(&id, paper_id.as_deref(), &mode, &title, &created_at, &messages_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_conversations(state: State<Database>,
    paper_id: Option<String>) -> Result<Vec<db::ConversationRow>, String> {
    state.load_conversations(paper_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_setting(state: State<Database>, key: String, value: String,
    updated_at: String) -> Result<(), String> {
    state.save_setting(&key, &value, &updated_at).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_settings(state: State<Database>) -> Result<Vec<(String, String)>, String> {
    state.load_settings().map_err(|e| e.to_string())
}

fn main() {
    let database = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(database)
        .invoke_handler(tauri::generate_handler![
            import_pdf,
            db_init,
            db_save_paper,
            db_load_papers,
            db_delete_paper,
            db_save_note_group,
            db_load_note_groups,
            db_delete_note_group,
            db_save_note,
            db_load_notes,
            db_delete_note,
            db_save_conversation,
            db_load_conversations,
            db_save_setting,
            db_load_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Liteasy desktop");
}
```

- [ ] **Step 3: Compile and verify Rust layer builds**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop/src-tauri && cargo check 2>&1`
Expected: `Finished` with no errors

---

### Task 3: Frontend — notes types and store

**Files:**
- Create: `desktop/src/app/features/notes/notes.types.ts`
- Create: `desktop/src/app/features/notes/notes.store.ts`

- [ ] **Step 1: Create notes.types.ts**

```ts
export type NoteGroup = {
  id: string;
  paperId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

export type Note = {
  id: string;
  groupId: string;
  paperId: string;
  selectedText: string;
  noteText: string;
  pageNo: number;
  bbox: string | null;
  color: string;
  createdAt: string;
};
```

- [ ] **Step 2: Create notes.store.ts**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { NoteGroup, Note } from "./notes.types";

export function createNotesStore() {
  const groups: NoteGroup[] = [];
  const notes: Note[] = [];
  let loaded = false;

  async function ensureLoaded() {
    if (loaded) return;
    try {
      const savedGroups = await invoke<NoteGroup[]>("db_load_note_groups", { paperId: "" });
      // Load all groups across all papers — load per-paper in practice
    } catch { /* Tauri not available */ }
    loaded = true;
  }

  return {
    async loadGroupsForPaper(paperId: string): Promise<NoteGroup[]> {
      try {
        return await invoke<NoteGroup[]>("db_load_note_groups", { paperId });
      } catch {
        return groups.filter(g => g.paperId === paperId);
      }
    },

    async addGroup(paperId: string, name: string): Promise<NoteGroup> {
      const group: NoteGroup = {
        id: `group-${Date.now()}`,
        paperId,
        name,
        sortOrder: groups.filter(g => g.paperId === paperId).length,
        createdAt: new Date().toISOString(),
      };
      groups.push(group);
      try {
        await invoke("db_save_note_group", {
          id: group.id, paperId, name, sortOrder: group.sortOrder,
          createdAt: group.createdAt,
        });
      } catch { /* offline fallback */ }
      return group;
    },

    async deleteGroup(id: string): Promise<void> {
      const idx = groups.findIndex(g => g.id === id);
      if (idx !== -1) groups.splice(idx, 1);
      try { await invoke("db_delete_note_group", { id }); } catch {}
    },

    async addNote(groupId: string, paperId: string, selectedText: string,
      noteText: string, pageNo: number, bbox: string | null): Promise<Note> {
      const note: Note = {
        id: `note-${Date.now()}`,
        groupId, paperId, selectedText, noteText, pageNo, bbox,
        color: "#ffeb3b",
        createdAt: new Date().toISOString(),
      };
      notes.push(note);
      try {
        await invoke("db_save_note", {
          id: note.id, groupId, paperId, selectedText, noteText,
          pageNo, bbox, color: note.color, createdAt: note.createdAt,
        });
      } catch {}
      return note;
    },

    async loadNotesForPaper(paperId: string): Promise<Note[]> {
      try {
        return await invoke<Note[]>("db_load_notes", { paperId, groupId: null });
      } catch {
        return notes.filter(n => n.paperId === paperId);
      }
    },

    async deleteNote(id: string): Promise<void> {
      const idx = notes.findIndex(n => n.id === id);
      if (idx !== -1) notes.splice(idx, 1);
      try { await invoke("db_delete_note", { id }); } catch {}
    },

    getLocalGroups(paperId: string): NoteGroup[] {
      return groups.filter(g => g.paperId === paperId);
    },

    getLocalNotes(groupId: string): Note[] {
      return notes.filter(n => n.groupId === groupId);
    },
  };
}
```

- [ ] **Step 3: Type-check the new files**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && npx tsc --noEmit src/app/features/notes/notes.types.ts src/app/features/notes/notes.store.ts 2>&1`
Expected: No errors (may have module resolution noise, that's fine)

---

### Task 4: Frontend — reader store for PDF.js state

**Files:**
- Create: `desktop/src/app/features/reader/reader.store.ts`

- [ ] **Step 1: Create reader.store.ts**

```ts
export type Highlight = {
  id: string;
  pageNo: number;
  bbox: string;        // JSON-serialized rect: {x,y,width,height}
  color: string;
  noteId?: string;
};

export function createReaderStore() {
  let pageNumber = 1;
  let totalPages = 0;
  let scale = 1.2;
  const highlights: Highlight[] = [];

  return {
    getPageNumber() { return pageNumber; },
    setPageNumber(n: number) { pageNumber = n; },
    getTotalPages() { return totalPages; },
    setTotalPages(n: number) { totalPages = n; },
    getScale() { return scale; },
    setScale(s: number) { scale = s; },

    addHighlight(h: Highlight) {
      highlights.push(h);
    },
    removeHighlight(id: string) {
      const idx = highlights.findIndex(h => h.id === id);
      if (idx !== -1) highlights.splice(idx, 1);
    },
    getHighlightsForPage(pageNo: number): Highlight[] {
      return highlights.filter(h => h.pageNo === pageNo);
    },
    getAllHighlights(): Highlight[] {
      return highlights;
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && npx tsc --noEmit src/app/features/reader/reader.store.ts 2>&1`
Expected: No errors

---

### Task 5: Frontend — persist existing stores to SQLite

**Files:**
- Modify: `desktop/src/app/features/workspace/workspace.store.ts`
- Modify: `desktop/src/app/features/settings/settings.store.ts`
- Modify: `desktop/src/app/features/assistant/assistant.store.ts`

- [ ] **Step 1: Modify workspace.store.ts — add persistence hooks**

Read the file first. The `createWorkspaceStore` function returns an object. Add an `initFromDb` method. Insert after the state declaration, before the return:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { Paper } from "./workspace.types";

// Inside createWorkspaceStore(), before the return statement:
const initFromDb = async () => {
  try {
    const rows = await invoke<Array<{
      id: string; title: string; file_path: string;
      content: string; page_count: number; imported_at: string;
    }>>("db_load_papers");
    for (const r of rows) {
      state.papers.push({
        id: r.id,
        title: r.title,
        filePath: r.file_path,
        content: {
          fullText: r.content,
          pageCount: r.page_count,
          importedAt: r.imported_at,
        },
      });
    }
  } catch { /* Tauri not available */ }
};

// Add initFromDb to the returned object

const persistPaper = async (paper: Paper) => {
  try {
    await invoke("db_save_paper", {
      id: paper.id,
      title: paper.title,
      filePath: paper.filePath,
      content: paper.content?.fullText ?? "",
      pageCount: paper.content?.pageCount ?? 0,
      importedAt: paper.content?.importedAt ?? new Date().toISOString(),
    });
  } catch {}
};
```

Then modify `addPaper` to call `persistPaper(paper)` after pushing.

- [ ] **Step 2: Modify settings.store.ts — add persistence hooks**

Insert at top: `import { invoke } from "@tauri-apps/api/core";`

Add inside the returned store object:

```ts
async initFromDb() {
  try {
    const rows = await invoke<Array<[string, string]>>("db_load_settings");
    for (const [k, v] of rows) {
      values.set(k, v);
    }
  } catch {}
},
```

Modify `set` method — after `values.set(key, value)`, add:

```ts
try {
  invoke("db_save_setting", { key, value: String(value), updatedAt: new Date().toISOString() });
} catch {}
```

- [ ] **Step 3: Modify assistant.store.ts — add conversation persistence**

Insert at top: `import { invoke } from "@tauri-apps/api/core";`

Add inside the returned store object:

```ts
async persistConversation(title: string) {
  try {
    await invoke("db_save_conversation", {
      id: `conv-${Date.now()}`,
      paperId: null,
      mode: state.mode,
      title,
      createdAt: new Date().toISOString(),
      messagesJson: JSON.stringify(state.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citationRefs: null,
        createdAt: new Date().toISOString(),
      }))),
    });
  } catch {}
},
```

---

### Task 6: Install pdfjs-dist and configure Vite

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/vite.config.ts`

- [ ] **Step 1: Install pdfjs-dist**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && npm install pdfjs-dist@4 2>&1 | tail -5`
Expected: `added N packages` with no errors

- [ ] **Step 2: Verify vite.config.ts handles PDF.js worker**

Add to `vite.config.ts` under `defineConfig`:

```ts
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/tests/setup.ts",
  },
});
```

The key addition is `optimizeDeps: { exclude: ["pdfjs-dist"] }` to prevent Vite from pre-bundling the PDF.js worker.

---

### Task 7: Rewrite ReaderPane with PDF.js

**Files:**
- Modify: `desktop/src/app/features/reader/ReaderPane.tsx` (complete rewrite)

- [ ] **Step 1: Write the new ReaderPane with PDF.js rendering**

Replace entire file content:

```tsx
import { useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Highlight } from "./reader.store";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type ReaderPaneProps = {
  filePath: string;
  pageNumber: number;
  scale: number;
  highlights: Highlight[];
  onPageChange: (n: number) => void;
  onScaleChange: (s: number) => void;
  onTotalPages: (n: number) => void;
  onTextSelect: (text: string, pageNo: number, bbox: string | null) => void;
};

export function ReaderPane({
  filePath, pageNumber, scale, highlights,
  onPageChange, onScaleChange, onTotalPages, onTextSelect,
}: ReaderPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const url = filePath ? convertFileSrc(filePath) : null;

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfRef.current || !canvasRef.current) return;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    const page = await pdfRef.current.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d")!;

    // Clear text layer
    if (textLayerRef.current) textLayerRef.current.innerHTML = "";

    const renderTask = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = renderTask;
    await renderTask.promise;

    // Render text layer for selection
    const textContent = await page.getTextContent();
    if (textLayerRef.current) {
      pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerRef.current,
        viewport,
        textDivs: [],
      });

      // Attach selection listener
      textLayerRef.current.addEventListener("mouseup", () => {
        const sel = window.getSelection();
        if (sel && sel.toString().trim()) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const containerRect = textLayerRef.current!.getBoundingClientRect();
          const bbox = JSON.stringify({
            x: rect.x - containerRect.x,
            y: rect.y - containerRect.y,
            width: rect.width,
            height: rect.height,
          });
          onTextSelect(sel.toString().trim(), pageNum, bbox);
        }
      });
    }

    // Render highlight overlays
    const pageHighlights = highlights.filter(h => h.pageNo === pageNum);
    for (const h of pageHighlights) {
      try {
        const b = JSON.parse(h.bbox) as { x: number; y: number; width: number; height: number };
        ctx.fillStyle = h.color + "40";
        ctx.fillRect(b.x * (scale / scale), b.y, b.width, b.height);
      } catch {}
    }

    renderTaskRef.current = null;
  }, [scale, highlights, onTextSelect]);

  // Load PDF document
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    pdfjsLib.getDocument(url).promise.then((pdf) => {
      if (cancelled) return;
      pdfRef.current = pdf;
      onTotalPages(pdf.numPages);
      renderPage(pageNumber);
    });
    return () => { cancelled = true; pdfRef.current?.destroy(); };
  }, [url]);

  // Re-render on page or scale change
  useEffect(() => {
    if (pdfRef.current) renderPage(pageNumber);
  }, [pageNumber, scale, renderPage]);

  return (
    <div className="reader-pane">
      <div className="reader-toolbar">
        <button onClick={() => { const p = pageNumber - 1; if (p > 0) onPageChange(p); }}
          disabled={pageNumber <= 1}>◀</button>
        <span className="reader-page-indicator">第 {pageNumber} 页</span>
        <button onClick={() => onPageChange(pageNumber + 1)}>▶</button>
        <span className="reader-toolbar-sep">|</span>
        <button onClick={() => onScaleChange(Math.max(0.5, scale - 0.25))}
          disabled={scale <= 0.5}>🔍−</button>
        <span className="reader-scale-label">{Math.round(scale * 100)}%</span>
        <button onClick={() => onScaleChange(Math.min(3, scale + 0.25))}
          disabled={scale >= 3}>🔍+</button>
      </div>
      <div className="reader-viewport">
        <div className="reader-page-container">
          <canvas ref={canvasRef} className="reader-canvas" />
          <div ref={textLayerRef} className="reader-text-layer" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check the new ReaderPane**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && npx tsc --noEmit src/app/features/reader/ReaderPane.tsx 2>&1`
Expected: No errors (some unused-var warnings OK)

---

### Task 8: Create floating menu component

**Files:**
- Create: `desktop/src/app/features/reader/SelectionMenu.tsx`

- [ ] **Step 1: Create SelectionMenu.tsx**

```tsx
import { useState } from "react";

type SelectionMenuProps = {
  visible: boolean;
  x: number;
  y: number;
  onHighlight: () => void;
  onAnnotate: () => void;
  onCopy: () => void;
};

export function SelectionMenu({ visible, x, y, onHighlight, onAnnotate, onCopy }: SelectionMenuProps) {
  if (!visible) return null;

  return (
    <div className="selection-menu" style={{ left: x, top: y - 40 }}>
      <button className="selection-menu-btn" onClick={onHighlight}>🖍 高亮</button>
      <button className="selection-menu-btn" onClick={onAnnotate}>📝 批注</button>
      <button className="selection-menu-btn" onClick={onCopy}>📋 复制</button>
    </div>
  );
}
```

---

### Task 9: Create NotesPanel component

**Files:**
- Create: `desktop/src/app/features/notes/NotesPanel.tsx`

- [ ] **Step 1: Create NotesPanel.tsx**

```tsx
import { useState, useEffect } from "react";
import type { NoteGroup, Note } from "./notes.types";

type NotesPanelProps = {
  papers: Array<{ id: string; title: string }>;
  notesStore: ReturnType<typeof import("./notes.store").createNotesStore>;
  onJumpToNote: (paperId: string, filePath: string, pageNo: number) => void;
  paperPaths: Map<string, string>; // paperId → filePath
};

export function NotesPanel({ papers, notesStore, onJumpToNote, paperPaths }: NotesPanelProps) {
  const [groups, setGroups] = useState<Map<string, NoteGroup[]>>(new Map());
  const [notes, setNotes] = useState<Map<string, Note[]>>(new Map());
  const [expandedPapers, setExpandedPapers] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  const refresh = () => setTick(n => n + 1);

  useEffect(() => {
    (async () => {
      const allGroups = new Map<string, NoteGroup[]>();
      const allNotes = new Map<string, Note[]>();
      for (const p of papers) {
        const gs = await notesStore.loadGroupsForPaper(p.id);
        allGroups.set(p.id, gs);
        const ns = await notesStore.loadNotesForPaper(p.id);
        allNotes.set(p.id, ns);
      }
      setGroups(allGroups);
      setNotes(allNotes);
    })();
  }, [papers]);

  const togglePaper = (id: string) => {
    const next = new Set(expandedPapers);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedPapers(next);
  };

  const toggleGroup = (id: string) => {
    const next = new Set(expandedGroups);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedGroups(next);
  };

  const handleAddGroup = async (paperId: string) => {
    const name = newGroupName[paperId]?.trim();
    if (!name) return;
    await notesStore.addGroup(paperId, name);
    const gs = await notesStore.loadGroupsForPaper(paperId);
    setGroups(prev => { prev.set(paperId, gs); return new Map(prev); });
    setNewGroupName(prev => ({ ...prev, [paperId]: "" }));
    refresh();
  };

  return (
    <div className="notes-panel">
      {papers.map(paper => (
        <div key={paper.id} className="notes-paper-group">
          <div className="notes-paper-header" onClick={() => togglePaper(paper.id)}>
            <span>{expandedPapers.has(paper.id) ? "▾" : "▸"}</span>
            <span>📄 {paper.title}</span>
          </div>
          {expandedPapers.has(paper.id) && (
            <div className="notes-group-list">
              {(groups.get(paper.id) || []).map(group => (
                <div key={group.id} className="notes-group-item">
                  <div className="notes-group-header" onClick={() => toggleGroup(group.id)}>
                    <span>{expandedGroups.has(group.id) ? "▾" : "▸"}</span>
                    <span>📁 {group.name}</span>
                  </div>
                  {expandedGroups.has(group.id) && (
                    <div className="notes-note-list">
                      {(notes.get(paper.id) || [])
                        .filter(n => n.groupId === group.id)
                        .map(note => (
                          <div key={note.id} className="notes-note-item"
                            onClick={() => {
                              const fp = paperPaths.get(paper.id);
                              if (fp) onJumpToNote(paper.id, fp, note.pageNo);
                            }}>
                            <div className="notes-note-text">{note.selectedText.slice(0, 80)}...</div>
                            {note.noteText && (
                              <div className="notes-note-comment">{note.noteText.slice(0, 60)}...</div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="notes-new-group">
                <input
                  className="notes-new-group-input"
                  placeholder="新建分组..."
                  value={newGroupName[paper.id] || ""}
                  onChange={e => setNewGroupName(prev => ({ ...prev, [paper.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") handleAddGroup(paper.id); }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

### Task 10: AppShell integration

**Files:**
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/app/features/artifacts/ArtifactTabs.tsx`

- [ ] **Step 1: Modify ArtifactTabs to pass through reader props**

Replace the ReaderPane usage in `ArtifactTabs.tsx`. Change the props type:

```tsx
import type { ArtifactTab } from "./artifact.types";
import type { Highlight } from "../reader/reader.store";

type ArtifactTabsProps = {
  tabs: ArtifactTab[];
  readerFilePaths: Map<string, string>;   // paperId → filePath
  readerPageNumber: number;
  readerScale: number;
  readerHighlights: Highlight[];
  onReaderPageChange: (n: number) => void;
  onReaderScaleChange: (s: number) => void;
  onTotalPages: (n: number) => void;
  onTextSelect: (text: string, pageNo: number, bbox: string | null) => void;
};
```

And in the component body, replace the ReaderPane import and usage. At the top, change to:

```tsx
import { ReaderPane } from "../reader/ReaderPane";
```

In the JSX where ReaderPane is rendered, use the new props:

```tsx
{hasReaderContent && readerMeta ? (
  <ReaderPane
    filePath={readerFilePaths.get(active.paperId ?? "") ?? ""}
    pageNumber={readerPageNumber}
    scale={readerScale}
    highlights={readerHighlights}
    onPageChange={onReaderPageChange}
    onScaleChange={onReaderScaleChange}
    onTotalPages={onTotalPages}
    onTextSelect={onTextSelect}
  />
) : ...
```

- [ ] **Step 2: Modify AppShell.tsx — integrate stores, NotesPanel, and persistence**

Key changes to `AppShell.tsx`:

1. Add imports for new stores and components
2. Create `notesStore`, `readerStore` instances
3. Add state for reader page/scale, selection menu position, paper file paths
4. Add `initFromDb` calls on mount
5. Add NotesPanel as a tab in right pane
6. Wire `handleTextSelect` to show selection menu
7. Wire `handleAnnotate` to open note annotation dialog

```tsx
// Add these imports:
import { createNotesStore } from "../features/notes/notes.store";
import { createReaderStore, type Highlight } from "../features/reader/reader.store";
import { SelectionMenu } from "../features/reader/SelectionMenu";
import { NotesPanel } from "../features/notes/NotesPanel";

// Inside AppShell(), add store instances:
const notesStore = useRef(createNotesStore()).current;
const readerStore = useRef(createReaderStore()).current;

// Add state:
const [readerPage, setReaderPage] = useState(1);
const [readerScale, setReaderScale] = useState(1.2);
const [readerHighlights, setReaderHighlights] = useState<Highlight[]>([]);
const [paperFilePaths, setPaperFilePaths] = useState<Map<string, string>>(new Map());
const [selMenuVisible, setSelMenuVisible] = useState(false);
const [selMenuPos, setSelMenuPos] = useState({ x: 0, y: 0 });
const [selText, setSelText] = useState("");
const [selPageNo, setSelPageNo] = useState(1);
const [selBbox, setSelBbox] = useState<string | null>(null);
const [rightTab, setRightTab] = useState<"assistant" | "notes">("assistant");
const [pendingAnnotate, setPendingAnnotate] = useState(false);
const [annotateGroupId, setAnnotateGroupId] = useState("");
const [annotateText, setAnnotateText] = useState("");
```

Add `useEffect` for DB init on mount:

```tsx
useEffect(() => {
  (async () => {
    try { await invoke("db_init"); } catch {}
    await workspaceStore.initFromDb?.();
    await settingsStore.initFromDb?.();
    refresh();
  })();
}, []);
```

Add handler for text selection:

```tsx
const handleTextSelect = useCallback((text: string, pageNo: number, bbox: string | null) => {
  setSelText(text);
  setSelPageNo(pageNo);
  setSelBbox(bbox);
  setSelMenuPos({ x: 100, y: 200 }); // approximate — in production use actual mouse coords
  setSelMenuVisible(true);
}, []);
```

Add handler for annotate:

```tsx
const handleAnnotate = useCallback(() => {
  setSelMenuVisible(false);
  setPendingAnnotate(true);
}, []);
```

After `handleImport`, add the paper file path tracking:

```tsx
// In handleImport, after successful import (both Tauri and mock paths):
setPaperFilePaths(prev => {
  const next = new Map(prev);
  next.set(paperId, filePath);
  return next;
});
```

Update the right pane JSX to include tabs:

```tsx
<section className="pane right">
  <div className="pane-header">
    <span style={{ cursor: "pointer", marginRight: 12 }}
      onClick={() => setRightTab("assistant")}
      className={rightTab === "assistant" ? "mode-button active" : "mode-button"}>
      AI 助手
    </span>
    <span style={{ cursor: "pointer" }}
      onClick={() => setRightTab("notes")}
      className={rightTab === "notes" ? "mode-button active" : "mode-button"}>
      笔记
    </span>
  </div>
  <div className="pane-body">
    {rightTab === "assistant" ? (
      <AssistantPane ... />
    ) : (
      <NotesPanel
        papers={workspaceStore.getState().papers.map(p => ({ id: p.id, title: p.title }))}
        notesStore={notesStore}
        onJumpToNote={(paperId, filePath, pageNo) => {
          setReaderPage(pageNo);
          artifactStore.setReaderContent(paperId, "跳转笔记", "");
        }}
        paperPaths={paperFilePaths}
      />
    )}
  </div>
</section>
```

Add the SelectionMenu and annotation modal in the JSX (near the end of the return):

```tsx
<SelectionMenu
  visible={selMenuVisible}
  x={selMenuPos.x}
  y={selMenuPos.y}
  onHighlight={() => {
    const h: Highlight = { id: `hl-${Date.now()}`, pageNo: selPageNo, bbox: selBbox ?? "{}", color: "#ffeb3b" };
    setReaderHighlights(prev => [...prev, h]);
    readerStore.addHighlight(h);
    setSelMenuVisible(false);
  }}
  onAnnotate={handleAnnotate}
  onCopy={() => {
    navigator.clipboard.writeText(selText).catch(() => {});
    setSelMenuVisible(false);
  }}
/>
{pendingAnnotate && (
  <div className="annotate-modal-overlay" onClick={() => setPendingAnnotate(false)}>
    <div className="annotate-modal" onClick={e => e.stopPropagation()}>
      <h4>添加批注</h4>
      <p className="annotate-selected-text">"{selText.slice(0, 100)}"</p>
      <select value={annotateGroupId} onChange={e => setAnnotateGroupId(e.target.value)}>
        <option value="">-- 选择分组 --</option>
        {notesStore.getLocalGroups(
          workspaceStore.getState().activePaperId ?? ""
        ).map(g => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
      <input placeholder="或输入新分组名称"
        onKeyDown={async e => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            const g = await notesStore.addGroup(
              workspaceStore.getState().activePaperId ?? "", e.currentTarget.value.trim()
            );
            setAnnotateGroupId(g.id);
            e.currentTarget.value = "";
          }
        }} />
      <textarea
        rows={4}
        placeholder="输入批注内容..."
        value={annotateText}
        onChange={e => setAnnotateText(e.target.value)}
      />
      <div className="annotate-modal-actions">
        <button onClick={() => setPendingAnnotate(false)}>取消</button>
        <button onClick={async () => {
          if (!annotateGroupId) return;
          const activeId = workspaceStore.getState().activePaperId;
          if (!activeId) return;
          await notesStore.addNote(annotateGroupId, activeId, selText, annotateText, selPageNo, selBbox);
          setPendingAnnotate(false);
          setAnnotateText("");
          setAnnotateGroupId("");
          refresh();
        }}>保存</button>
      </div>
    </div>
  </div>
)}
```

---

### Task 11: CSS styles for new components

**Files:**
- Modify: `desktop/src/app/styles/app.css` (append new styles)

- [ ] **Step 1: Append reader toolbar, PDF viewer, selection menu, and notes panel styles**

Append to `app.css`:

```css
/* ── Reader Toolbar ── */
.reader-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #d5e2ee;
  background: linear-gradient(180deg, rgba(248,252,255,0.95), rgba(238,245,250,0.95));
  border-radius: 8px 8px 0 0;
}

.reader-toolbar button {
  border: 1px solid #c8d8e6;
  border-radius: 6px;
  background: #fff;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 14px;
}
.reader-toolbar button:disabled { opacity: 0.4; cursor: default; }

.reader-page-indicator { font-size: 13px; color: #42576b; min-width: 80px; text-align: center; }
.reader-scale-label { font-size: 13px; color: #7b90a5; min-width: 48px; text-align: center; }
.reader-toolbar-sep { color: #c8d8e6; }

/* ── Reader Viewport ── */
.reader-viewport {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  justify-content: center;
  background: #f0f4f7;
}

.reader-page-container {
  position: relative;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}

.reader-canvas { display: block; }

.reader-text-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  line-height: 1;
  opacity: 0.2;
}
.reader-text-layer span {
  color: transparent;
  cursor: text;
  position: absolute;
  white-space: pre;
  transform-origin: 0 0;
}
.reader-text-layer span::selection {
  background: rgba(139,182,216,0.35);
  color: transparent;
}

/* ── Selection Menu ── */
.selection-menu {
  position: fixed;
  z-index: 1000;
  display: flex;
  gap: 2px;
  background: #333;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}

.selection-menu-btn {
  border: 0;
  background: transparent;
  color: #fff;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.selection-menu-btn:hover { background: rgba(255,255,255,0.15); }

/* ── Notes Panel ── */
.notes-panel { font-size: 13px; }

.notes-paper-group { margin-bottom: 8px; }

.notes-paper-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 6px;
  font-weight: 600;
  color: #2b4965;
}
.notes-paper-header:hover { background: rgba(139,182,216,0.1); }

.notes-group-list { padding-left: 18px; }

.notes-group-item { margin-bottom: 2px; }

.notes-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  color: #42576b;
}
.notes-group-header:hover { background: rgba(139,182,216,0.08); }

.notes-note-list { padding-left: 20px; }

.notes-note-item {
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  border-left: 3px solid #ffeb3b;
  margin-bottom: 4px;
}
.notes-note-item:hover { background: rgba(139,182,216,0.08); }

.notes-note-text { color: #405366; font-size: 12px; margin-bottom: 2px; }
.notes-note-comment { color: #7b90a5; font-size: 11px; font-style: italic; }

.notes-new-group { margin-top: 6px; }
.notes-new-group-input {
  width: 100%;
  border: 1px dashed #c8d8e6;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  color: #7b90a5;
}

/* ── Annotate Modal ── */
.annotate-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.annotate-modal {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 420px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}

.annotate-modal h4 { margin: 0; color: #214c73; }
.annotate-selected-text {
  font-size: 12px;
  color: #7b90a5;
  font-style: italic;
  background: #f7f9fb;
  padding: 8px;
  border-radius: 6px;
  max-height: 80px;
  overflow: auto;
}

.annotate-modal select,
.annotate-modal input,
.annotate-modal textarea {
  border: 1px solid #c8d8e6;
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
  color: #405366;
  resize: vertical;
}

.annotate-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.annotate-modal-actions button {
  border: 1px solid #c8d8e6;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
}
.annotate-modal-actions button:last-child {
  background: linear-gradient(180deg, #fefefe, #d9e9f7);
  color: #2b4965;
  font-weight: 700;
}
```

---

### Task 12: Write tests

**Files:**
- Create: `desktop/src/tests/notes.store.test.ts`

- [ ] **Step 1: Write notes.store test**

```ts
import { describe, it, expect } from "vitest";

describe("notes store", () => {
  it("adds and retrieves groups for a paper", async () => {
    // Mock Tauri invoke
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "关键公式");
    expect(g.name).toBe("关键公式");
    expect(g.paperId).toBe("paper-1");

    const local = store.getLocalGroups("paper-1");
    expect(local.length).toBe(1);
    expect(local[0].name).toBe("关键公式");
  });

  it("adds and retrieves notes for a group", async () => {
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "关键公式");
    const n = await store.addNote(g.id, "paper-1", "selected text", "my note", 3, null);

    expect(n.selectedText).toBe("selected text");
    expect(n.noteText).toBe("my note");
    expect(n.pageNo).toBe(3);
    expect(n.groupId).toBe(g.id);

    const local = store.getLocalNotes(g.id);
    expect(local.length).toBe(1);
    expect(local[0].id).toBe(n.id);
  });

  it("deletes a group", async () => {
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "临时分组");
    expect(store.getLocalGroups("paper-1").length).toBe(1);
    await store.deleteGroup(g.id);
    expect(store.getLocalGroups("paper-1").length).toBe(0);
  });

  it("deletes a note", async () => {
    const { createNotesStore } = await import("../app/features/notes/notes.store");
    const store = createNotesStore();

    const g = await store.addGroup("paper-1", "分组");
    const n = await store.addNote(g.id, "paper-1", "text", "comment", 1, null);
    expect(store.getLocalNotes(g.id).length).toBe(1);
    await store.deleteNote(n.id);
    expect(store.getLocalNotes(g.id).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run notes store tests**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && npx vitest run src/tests/notes.store.test.ts 2>&1`
Expected: 4 tests PASS

---

### Task 13: Full build verification

**Files:** (none — verification only)

- [ ] **Step 1: Run all existing tests**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && npx vitest run 2>&1`
Expected: All tests pass (existing 15 + 4 new = 19)

- [ ] **Step 2: TypeScript check entire project**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && npx tsc --noEmit 2>&1`
Expected: 0 errors

- [ ] **Step 3: Rust cargo check**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop/src-tauri && cargo check 2>&1`
Expected: `Finished` with no errors

- [ ] **Step 4: Full Tauri build**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && source "$HOME/.cargo/env" && npm run tauri build 2>&1 | tail -20`
Expected: Build completes successfully

- [ ] **Step 5: Launch and manually verify**

Run: `cd /home/marks/Liteasy-main/Liteasy-main/desktop && WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 npm run tauri dev 2>&1`
Manual checklist:
- [ ] Import PDF → paper appears in library
- [ ] Select paper → PDF renders in center pane with page navigation
- [ ] Select text → floating menu appears
- [ ] Add annotation → saved to group
- [ ] Switch to Notes tab → see annotation in hierarchy
- [ ] Close and restart app → papers and notes persist
