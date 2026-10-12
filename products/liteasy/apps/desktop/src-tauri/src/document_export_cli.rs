//! Explicit local Markdown CLI. Rendering uses the same packaged TypeScript service as the GUI.
use crate::artifact_export::{ArtifactExportFormat, ArtifactExportInput};
use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewWindow};

#[derive(Clone)]
pub struct ExportCliRequest {
    source: PathBuf,
    output: PathBuf,
    format: String,
    overwrite: bool,
}
pub struct ExportCliState {
    pub request: ExportCliRequest,
    finished: Mutex<bool>,
}
impl ExportCliState {
    pub fn new(request: ExportCliRequest) -> Self {
        Self {
            request,
            finished: Mutex::new(false),
        }
    }
}
pub fn parse_args(args: &[String]) -> Result<Option<ExportCliRequest>, String> {
    if args.get(0).map(String::as_str) != Some("--agent-cli")
        || args.get(1).map(String::as_str) != Some("document-export")
    {
        return Ok(None);
    }
    let mut source = None;
    let mut output = None;
    let mut format = None;
    let mut overwrite = false;
    for pair in args[2..].chunks(2) {
        if pair.len() != 2 {
            return Err("Usage: --agent-cli document-export --input source.md --format pdf|markdown|docx|html --output target".into());
        }
        match pair[0].as_str() {
            "--input" if source.is_none() => source = Some(PathBuf::from(&pair[1])),
            "--output" if output.is_none() => output = Some(PathBuf::from(&pair[1])),
            "--format" if format.is_none() => format = Some(pair[1].clone()),
            "--overwrite" if pair[1] == "true" => overwrite = true,
            _ => return Err("Unknown or duplicate export option".into()),
        }
    }
    let source = source.ok_or("Missing --input")?;
    if !matches!(
        source.extension().and_then(|s| s.to_str()),
        Some("md" | "markdown" | "txt")
    ) {
        return Err("CLI currently accepts explicit Markdown/text files; native paper/board sources require their registered GUI adapters".into());
    }
    let format = format.ok_or("Missing --format")?;
    if !matches!(format.as_str(), "pdf" | "markdown" | "docx" | "html") {
        return Err("Unsupported export format".into());
    }
    Ok(Some(ExportCliRequest {
        source,
        output: output.ok_or("Missing --output")?,
        format,
        overwrite,
    }))
}
fn guard(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "document-export-cli" {
        return Err("CLI task capability unavailable".into());
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSource {
    markdown: String,
    title: String,
    format: String,
}
#[tauri::command]
pub fn document_export_cli_source(
    window: WebviewWindow,
    state: State<'_, ExportCliState>,
) -> Result<CliSource, String> {
    guard(&window)?;
    let metadata = std::fs::metadata(&state.request.source).map_err(|e| e.to_string())?;
    if metadata.len() > 8 * 1024 * 1024 {
        return Err("Source exceeds 8 MiB".into());
    }
    let bytes = std::fs::read(&state.request.source).map_err(|e| e.to_string())?;
    let after = std::fs::metadata(&state.request.source).map_err(|e| e.to_string())?;
    if metadata.len() != after.len()
        || metadata.modified().ok() != after.modified().ok()
        || bytes.len() as u64 != after.len()
    {
        return Err("Source changed while freezing bytes; retry the export".into());
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Source exceeds 8 MiB".into());
    }
    let markdown = String::from_utf8(bytes).map_err(|_| "Source must be UTF-8")?;
    let title = state
        .request
        .source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Liteasy report")
        .to_string();
    Ok(CliSource {
        markdown,
        title,
        format: state.request.format.clone(),
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliImage {
    base64: String,
    media_type: String,
}
fn granted_image(source: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || relative.len() > 2048
        || relative.contains(['\\', ':', '?', '#'])
        || relative.starts_with('/')
        || Path::new(relative).components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("Image is outside the explicit source directory grant".into());
    }
    let root = std::fs::canonicalize(source.parent().unwrap_or(Path::new(".")))
        .map_err(|e| e.to_string())?;
    let path = std::fs::canonicalize(root.join(relative)).map_err(|e| e.to_string())?;
    if !path.starts_with(&root) {
        return Err("Image symlink escapes the source directory".into());
    }
    Ok(path)
}
#[tauri::command]
pub fn document_export_cli_image(
    window: WebviewWindow,
    state: State<'_, ExportCliState>,
    relative: String,
) -> Result<CliImage, String> {
    guard(&window)?;
    let path = granted_image(&state.request.source, &relative)?;
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
        return Err("Image exceeds 20 MiB".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let media_type = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        return Err("Unsupported image signature".into());
    };
    Ok(CliImage {
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        media_type: media_type.into(),
    })
}
#[tauri::command]
pub fn document_export_cli_complete(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, ExportCliState>,
    input: Option<ArtifactExportInput>,
    error: Option<String>,
) -> Result<(), String> {
    guard(&window)?;
    let mut finished = state
        .finished
        .lock()
        .map_err(|_| "CLI task lock unavailable")?;
    if *finished {
        return Err("CLI task already completed".into());
    }
    *finished = true;
    let result = if let Some(mut input) = input {
        let expected: ArtifactExportFormat =
            serde_json::from_value(serde_json::Value::String(state.request.format.clone()))
                .map_err(|e| e.to_string())?;
        if state.request.output.exists() && !state.request.overwrite {
            Err(
                "Output exists; use --overwrite true to authorize replacing this exact destination"
                    .into(),
            )
        } else if input.format != expected {
            Err("Output format differs from CLI request".into())
        } else {
            input.protected_paths = vec![state.request.source.clone()];
            crate::artifact_export::save_export_at(app.clone(), input, state.request.output.clone())
        }
    } else {
        Err(error.unwrap_or("Export task failed".into()))
    };
    let code = if result.is_ok() { 0 } else { 1 };
    match result {
        Ok(outcome) => println!("{}", serde_json::json!({"ok":true,"outcome":outcome})),
        Err(error) => println!("{}", serde_json::json!({"ok":false,"error":error})),
    }
    app.exit(code);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cli_requires_explicit_input_format_and_destination() {
        let args = |extra: &[&str]| {
            [vec!["--agent-cli", "document-export"], extra.to_vec()]
                .concat()
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
        };
        assert!(parse_args(&args(&[
            "--input",
            "source.md",
            "--format",
            "docx",
            "--output",
            "report.docx"
        ]))
        .unwrap()
        .is_some());
        for extra in [
            &["--input", "source.md"][..],
            &[
                "--input",
                "paper.pdf",
                "--format",
                "pdf",
                "--output",
                "report.pdf",
            ][..],
            &[
                "--input", "s.md", "--format", "unknown", "--output", "report",
            ],
        ] {
            assert!(parse_args(&args(extra)).is_err());
        }
    }
    #[test]
    fn relative_image_grant_rejects_paths_and_protocols() {
        for relative in [
            "../secret.png",
            "C:\\secret.png",
            "https://remote/image.png",
            "/etc/secret",
            "file:///etc/secret",
        ] {
            assert!(granted_image(Path::new("source.md"), relative).is_err());
        }
    }
}
