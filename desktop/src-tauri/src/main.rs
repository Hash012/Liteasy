#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod db;

use db::Database;
use pdf_extract::extract_text;
use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
    if count == 0 {
        1
    } else {
        count
    }
}

// ── Database Tauri commands ──────────────────────────────────────────

#[tauri::command]
fn db_init(db: tauri::State<'_, Database>) -> Result<(), String> {
    db.init_tables().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_paper(
    db: tauri::State<'_, Database>,
    id: String,
    title: String,
    file_path: String,
    content: String,
    page_count: usize,
    imported_at: String,
) -> Result<(), String> {
    db.save_paper(&id, &title, &file_path, &content, page_count, &imported_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_papers(db: tauri::State<'_, Database>) -> Result<Vec<db::PaperRow>, String> {
    db.load_papers().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_paper(db: tauri::State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_paper(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_note_group(
    db: tauri::State<'_, Database>,
    id: String,
    paper_id: String,
    name: String,
    sort_order: i32,
    created_at: String,
) -> Result<(), String> {
    db.save_note_group(&id, &paper_id, &name, sort_order, &created_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_note_groups(
    db: tauri::State<'_, Database>,
    paper_id: String,
) -> Result<Vec<db::NoteGroupRow>, String> {
    db.load_note_groups(&paper_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_note_group(db: tauri::State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_note_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_note(
    db: tauri::State<'_, Database>,
    id: String,
    group_id: String,
    paper_id: String,
    selected_text: String,
    note_text: String,
    page_no: usize,
    bbox: Option<String>,
    color: String,
    created_at: String,
) -> Result<(), String> {
    db.save_note(
        &id,
        &group_id,
        &paper_id,
        &selected_text,
        &note_text,
        page_no,
        bbox.as_deref(),
        &color,
        &created_at,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_notes(
    db: tauri::State<'_, Database>,
    paper_id: Option<String>,
    group_id: Option<String>,
) -> Result<Vec<db::NoteRow>, String> {
    db.load_notes(paper_id.as_deref(), group_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_note(db: tauri::State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_note(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_conversation(
    db: tauri::State<'_, Database>,
    id: String,
    paper_id: Option<String>,
    mode: String,
    title: String,
    created_at: String,
    messages_json: String,
) -> Result<(), String> {
    db.save_conversation(&id, paper_id.as_deref(), &mode, &title, &created_at, &messages_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_conversations(
    db: tauri::State<'_, Database>,
    paper_id: Option<String>,
) -> Result<Vec<db::ConversationRow>, String> {
    db.load_conversations(paper_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_messages(
    db: tauri::State<'_, Database>,
    conversation_id: String,
) -> Result<Vec<db::MessageRow>, String> {
    db.load_messages(&conversation_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_setting(
    db: tauri::State<'_, Database>,
    key: String,
    value: String,
    updated_at: String,
) -> Result<(), String> {
    db.save_setting(&key, &value, &updated_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_load_settings(db: tauri::State<'_, Database>) -> Result<Vec<(String, String)>, String> {
    db.load_settings().map_err(|e| e.to_string())
}

#[tauri::command]
fn read_pdf_bytes(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("无法读取文件: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

// ── main ─────────────────────────────────────────────────────────────

fn main() {
    let database = Database::new().expect("Failed to initialize database");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            db_load_messages,
            db_save_setting,
            db_load_settings,
            read_pdf_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Liteasy desktop");
}
