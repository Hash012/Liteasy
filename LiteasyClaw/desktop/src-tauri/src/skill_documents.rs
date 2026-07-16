use std::fs;
use std::path::{Path, PathBuf};

fn is_safe_skill_filename(filename: &str) -> bool {
    filename.ends_with(".md")
        && filename
            .trim_end_matches(".md")
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn find_workspace_root() -> Result<PathBuf, String> {
    let current_dir = std::env::current_dir().map_err(|error| error.to_string())?;
    for candidate in current_dir.ancestors() {
        if candidate.join("project-docs/agent-dev/skills").is_dir() {
            return Ok(candidate.to_path_buf());
        }
    }

    Err("未找到 project-docs/agent-dev/skills 目录，无法保存 skill 文档。".to_string())
}

#[tauri::command]
pub fn save_skill_document(source_path: String, markdown: String) -> Result<(), String> {
    let filename = Path::new(&source_path)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Skill 文档路径缺少文件名。".to_string())?;

    // 这里故意只接受小写短横线命名的 Markdown 文件，避免前端传入 ../ 之类的路径。
    if !is_safe_skill_filename(filename) {
        return Err("Skill 文档文件名必须使用小写短横线并以 .md 结尾。".to_string());
    }

    let workspace_root = find_workspace_root()?;
    let skill_document_path = workspace_root
        .join("project-docs/agent-dev/skills")
        .join(filename);
    fs::write(skill_document_path, markdown).map_err(|error| error.to_string())
}
