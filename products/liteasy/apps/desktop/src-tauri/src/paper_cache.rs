use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::local_library::{library_papers_directory, unique_pdf_target, MAX_PDF_BYTES};

const CACHE_DIRECTORY_NAME: &str = "paper-cache";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperCacheUsage {
    pub byte_length: u64,
    pub file_count: usize,
}

/// Cached papers are named after their content fingerprint so the same paper reached
/// from different anchors resolves to one file instead of one copy per click.
fn content_hash_file_name(content_hash: &str) -> Result<String, String> {
    let trimmed = content_hash.trim();
    if trimmed.len() != 64 || !trimmed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("论文内容指纹无效。".to_string());
    }
    Ok(format!("{}.pdf", trimmed.to_ascii_lowercase()))
}

fn looks_like_pdf(bytes: &[u8]) -> bool {
    bytes.len() > 5 && bytes.starts_with(b"%PDF-")
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = crate::data_location::root(app)?.join(CACHE_DIRECTORY_NAME);
    fs::create_dir_all(&root).map_err(|error| format!("无法创建论文缓存目录：{error}"))?;
    root.canonicalize()
        .map_err(|error| format!("无法访问论文缓存目录：{error}"))
}

/// New downloads follow the configured data root. Old cached links remain readable.
pub(crate) fn cache_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut roots = vec![cache_root(app)?];
    let legacy = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(CACHE_DIRECTORY_NAME);
    if legacy.is_dir() {
        let legacy = legacy.canonicalize().map_err(|e| e.to_string())?;
        if !roots.contains(&legacy) {
            roots.push(legacy);
        }
    }
    Ok(roots)
}

fn resolve_cache_path(app: &AppHandle, requested: &str) -> Result<PathBuf, String> {
    let remapped = crate::data_location::remap_path(Path::new(requested));
    resolve_from_cache_roots(&cache_roots(app)?, &remapped)
}

fn resolve_from_cache_roots(roots: &[PathBuf], requested: &Path) -> Result<PathBuf, String> {
    roots
        .iter()
        .find_map(|root| resolve_cached_pdf(root, &requested.to_string_lossy()).ok())
        .ok_or_else(|| "找不到缓存 PDF，或文件不属于论文缓存目录。".into())
}

fn resolve_cached_pdf(root: &Path, requested_path: &str) -> Result<PathBuf, String> {
    let canonical = PathBuf::from(requested_path)
        .canonicalize()
        .map_err(|error| format!("找不到缓存的 PDF：{error}"))?;
    if canonical == root || !canonical.starts_with(root) {
        return Err("只能访问论文缓存目录内的文件。".to_string());
    }
    if !canonical.is_file()
        || !canonical
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("缓存中的目标不是 PDF 文件。".to_string());
    }
    Ok(canonical)
}

/// Renaming is the fast path, but the cache and the library can sit on different
/// volumes once the library root is user-configurable, so fall back to a copy.
fn move_file_across_volumes(source: &Path, target: &Path) -> Result<(), String> {
    if fs::rename(source, target).is_ok() {
        return Ok(());
    }
    fs::copy(source, target).map_err(|error| format!("转入文献库失败：{error}"))?;
    // A leftover cache copy is harmless — the cache is disposable by definition.
    let _ = fs::remove_file(source);
    Ok(())
}

#[tauri::command]
pub fn cache_external_pdf(
    app: AppHandle,
    content_hash: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if !looks_like_pdf(&bytes) {
        return Err("下载的文件不是 PDF。".to_string());
    }
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err("PDF 文件超过 256 MB，无法缓存。".to_string());
    }
    let root = cache_root(&app)?;
    let target = root.join(content_hash_file_name(&content_hash)?);
    if target.is_file() {
        // Already cached under the same fingerprint; reuse it rather than rewriting.
        return Ok(target.to_string_lossy().to_string());
    }
    fs::write(&target, bytes).map_err(|error| format!("写入论文缓存失败：{error}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_cached_pdf(app: AppHandle, cache_path: String) -> Result<Vec<u8>, String> {
    let source = resolve_cache_path(&app, &cache_path)?;
    let size = fs::metadata(&source)
        .map_err(|error| format!("无法读取缓存 PDF 信息：{error}"))?
        .len();
    if size == 0 {
        return Err("缓存的 PDF 文件为空。".to_string());
    }
    if size > MAX_PDF_BYTES {
        return Err("缓存的 PDF 超过 256 MB。".to_string());
    }
    fs::read(source).map_err(|error| format!("读取缓存 PDF 失败：{error}"))
}

/// Promotion moves the file out of the cache instead of copying it, so a promoted
/// paper has exactly one authoritative body on disk.
#[tauri::command]
pub fn promote_cached_pdf_to_library(
    app: AppHandle,
    cache_path: String,
    file_name: String,
) -> Result<String, String> {
    let source = resolve_cache_path(&app, &cache_path)?;
    let papers = library_papers_directory(&app)?;
    let target = unique_pdf_target(&papers, &file_name)?;
    move_file_across_volumes(&source, &target)?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn paper_cache_usage(app: AppHandle) -> Result<PaperCacheUsage, String> {
    let mut usage = PaperCacheUsage {
        byte_length: 0,
        file_count: 0,
    };
    for root in cache_roots(&app)? {
        for entry in
            fs::read_dir(&root).map_err(|error| format!("无法读取论文缓存目录：{error}"))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                usage.byte_length += entry.metadata().map(|data| data.len()).unwrap_or(0);
                usage.file_count += 1;
            }
        }
    }
    Ok(usage)
}

#[tauri::command]
pub fn clear_paper_cache(app: AppHandle) -> Result<PaperCacheUsage, String> {
    let mut removed = PaperCacheUsage {
        byte_length: 0,
        file_count: 0,
    };
    for root in cache_roots(&app)? {
        for entry in
            fs::read_dir(&root).map_err(|error| format!("无法读取论文缓存目录：{error}"))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }
            let size = entry.metadata().map(|data| data.len()).unwrap_or(0);
            if fs::remove_file(entry.path()).is_ok() {
                removed.byte_length += size;
                removed.file_count += 1;
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::{content_hash_file_name, looks_like_pdf};
    #[test]
    fn reads_current_and_legacy_caches_without_allowing_other_locations() {
        use super::*;
        let base = std::env::temp_dir().join(format!(
            "liteasy-cache-roots-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(base.join("current")).unwrap();
        fs::create_dir_all(base.join("legacy")).unwrap();
        let base = base.canonicalize().unwrap();
        let roots = vec![base.join("current"), base.join("legacy")];
        for root in &roots {
            let file = root.join("paper.pdf");
            fs::write(&file, b"%PDF-1.7").unwrap();
            assert_eq!(resolve_from_cache_roots(&roots, &file).unwrap(), file);
        }
        fs::write(base.join("outside.pdf"), b"%PDF-1.7").unwrap();
        assert!(resolve_from_cache_roots(&roots, &base.join("outside.pdf")).is_err());
        assert!(resolve_from_cache_roots(&roots, &base.join("missing.pdf")).is_err());
        fs::remove_dir_all(base).unwrap();
    }

    const VALID_HASH: &str = "0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789abcdef";

    #[test]
    fn names_cached_papers_after_their_lowercased_fingerprint() {
        let name = content_hash_file_name(VALID_HASH).expect("valid fingerprint");
        assert_eq!(name, format!("{}.pdf", VALID_HASH.to_ascii_lowercase()));
    }

    #[test]
    fn rejects_fingerprints_that_could_escape_the_cache_directory() {
        assert!(content_hash_file_name("../../outside").is_err());
        assert!(content_hash_file_name("").is_err());
        assert!(content_hash_file_name(&"a".repeat(63)).is_err());
        assert!(content_hash_file_name(&format!("{}/", &VALID_HASH[..63])).is_err());
    }

    #[test]
    fn only_accepts_bytes_that_start_with_the_pdf_marker() {
        assert!(looks_like_pdf(b"%PDF-1.7 trailing"));
        assert!(!looks_like_pdf(b"%PDF-"));
        assert!(!looks_like_pdf(b"<!doctype html>"));
        assert!(!looks_like_pdf(b""));
    }
}
