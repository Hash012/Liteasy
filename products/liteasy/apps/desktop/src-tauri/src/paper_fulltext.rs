use base64::{engine::general_purpose::STANDARD, Engine};
use openidconnect::reqwest;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use url::Url;

#[derive(Default)]
pub struct FullTextState {
    pub(crate) requests: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    received: u64,
    total: Option<u64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentResponse {
    status: u16,
    final_url: String,
    body_base64: String,
    download_id: Option<String>,
    content_hash: Option<String>,
    byte_length: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRequest {
    request_id: String,
    url: String,
    probe: bool,
    openalex_config: Option<crate::paper_services::PaperServiceConfig>,
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("全文任务标识无效。".into());
    }
    Ok(())
}
fn staged_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "缓存目录不可用。")?
        .join("fulltext");
    fs::create_dir_all(&dir).map_err(|_| "无法建立下载缓存。")?;
    Ok(dir.join(format!("{id}.pdf")))
}
struct PendingFile(PathBuf);
impl Drop for PendingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn safe_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "全文地址无效。")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("全文地址须使用 HTTPS。".into());
    }
    Ok(url)
}
fn is_pdf(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
}

async fn execute(
    app: AppHandle,
    input: DocumentRequest,
    progress: tauri::ipc::Channel<Progress>,
) -> Result<DocumentResponse, String> {
    let destination = staged_path(&app, &input.request_id)?;
    // Abandoned completed downloads are derived cache, never library files.
    if let Some(parent) = destination.parent() {
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                if entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age.as_secs() > 86400)
                {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    let client = reqwest::Client::builder()
        .user_agent("Liteasy/0.1 (literature reader)")
        .timeout(Duration::from_secs(if input.probe { 20 } else { 90 }))
        .connect_timeout(Duration::from_secs(10))
        .referer(false)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "网络初始化失败。")?;
    let mut url = safe_url(&input.url)?;
    let mut response = None;
    for hop in 0..=5 {
        let mut target = url.clone();
        // Content API credentials never cross a redirect, and only the documented host may receive them.
        if hop == 0 && target.host_str() == Some("content.openalex.org") {
            if let Some(config) = &input.openalex_config {
                if config.provider != "openalex"
                    || Url::parse(&config.endpoint)
                        .ok()
                        .and_then(|u| u.host_str().map(str::to_owned))
                        .as_deref()
                        != Some("api.openalex.org")
                {
                    return Err("OpenAlex 全文凭据配置无效。".into());
                }
                if let Ok(key) = crate::paper_services::credential(config)?.get_password() {
                    target.query_pairs_mut().append_pair("api_key", &key);
                }
            }
        }
        let mut request = client.get(target);
        if input.probe {
            request = request.header("Range", "bytes=0-2097151");
        }
        let result = request
            .send()
            .await
            .map_err(|_| "全文连接失败或超时，请检查网络或代理。")?;
        if result.status().is_redirection() {
            if hop == 5 {
                return Err("全文跳转次数过多。".into());
            }
            let location = result
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("全文跳转缺少地址。")?;
            url = safe_url(
                url.join(location)
                    .map_err(|_| "全文跳转地址无效。")?
                    .as_str(),
            )?;
            if let Some(config) = &input.openalex_config {
                if config.provider == "openalex" {
                    let pairs: Vec<(String, String)> = url
                        .query_pairs()
                        .filter(|(key, _)| !matches!(key.as_ref(), "api_key" | "apikey"))
                        .map(|(k, v)| (k.into_owned(), v.into_owned()))
                        .collect();
                    url.set_query(None);
                    if !pairs.is_empty() {
                        url.query_pairs_mut().extend_pairs(pairs);
                    }
                }
            }
            continue;
        }
        response = Some(result);
        break;
    }
    receive(
        response.ok_or("全文来源没有响应。")?,
        destination,
        &input.request_id,
        input.probe,
        progress,
        url.to_string(),
    )
    .await
}
async fn receive(
    mut response: reqwest::Response,
    destination: PathBuf,
    request_id: &str,
    probe: bool,
    progress: tauri::ipc::Channel<Progress>,
    final_url: String,
) -> Result<DocumentResponse, String> {
    let pending = PendingFile(destination.with_extension("part"));
    let status = response.status().as_u16();
    let total = response.content_length();
    let mut prefix = Vec::new();
    let mut file = None;
    let mut hash = Sha256::new();
    let mut received = 0_u64;
    let mut tail = Vec::new();
    let mut last_progress = std::time::Instant::now();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "全文传输中断，请重试。")?
    {
        received += chunk.len() as u64;
        tail.extend_from_slice(&chunk[chunk.len().saturating_sub(65536)..]);
        if tail.len() > 65536 {
            tail.drain(..tail.len() - 65536);
        }
        if file.is_none() {
            let room = (2 * 1024 * 1024_usize).saturating_sub(prefix.len());
            prefix.extend_from_slice(&chunk[..room.min(chunk.len())]);
            if prefix.len() < 5 {
                continue;
            }
            if is_pdf(&prefix) && (200..300).contains(&status) {
                if probe {
                    prefix.truncate(1024);
                    break;
                }
                if total.is_some_and(|size| size > crate::local_library::MAX_PDF_BYTES) {
                    return Err("PDF 超过 256 MB。".into());
                }
                let mut output = fs::File::create(&pending.0).map_err(|_| "无法创建下载文件。")?;
                output
                    .write_all(&prefix)
                    .map_err(|_| "无法写入下载文件。")?;
                hash.update(&prefix);
                if chunk.len() > room {
                    output
                        .write_all(&chunk[room..])
                        .map_err(|_| "无法写入下载文件。")?;
                    hash.update(&chunk[room..]);
                }
                file = Some(output);
                prefix.clear();
            } else if prefix.len() >= 2 * 1024 * 1024 {
                break;
            }
        } else {
            file.as_mut()
                .unwrap()
                .write_all(&chunk)
                .map_err(|_| "无法写入下载文件。")?;
            hash.update(&chunk);
        }
        if received > crate::local_library::MAX_PDF_BYTES {
            return Err("PDF 超过 256 MB。".into());
        }
        if last_progress.elapsed() > Duration::from_millis(150) {
            let _ = progress.send(Progress { received, total });
            last_progress = std::time::Instant::now();
        }
    }
    let stored = file.is_some();
    if let Some(file) = file {
        if total.is_some_and(|expected| received != expected)
            || !tail.windows(5).any(|part| part == b"%%EOF")
        {
            return Err("PDF 未完整传输，未导入文献库。请重新下载。".into());
        }
        file.sync_all().map_err(|_| "下载文件落盘失败。")?;
        drop(file);
        fs::rename(&pending.0, &destination).map_err(|_| "下载文件保存失败。")?;
    }
    let _ = progress.send(Progress { received, total });
    Ok(DocumentResponse {
        status,
        final_url,
        body_base64: STANDARD.encode(prefix),
        download_id: stored.then_some(request_id.to_string()),
        content_hash: stored.then(|| format!("{:x}", hash.finalize())),
        byte_length: received,
    })
}

#[tauri::command]
pub async fn request_public_document(
    app: AppHandle,
    state: State<'_, FullTextState>,
    input: DocumentRequest,
    progress: tauri::ipc::Channel<Progress>,
) -> Result<DocumentResponse, String> {
    validate_id(&input.request_id)?;
    let id = input.request_id.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let mut tasks = state.requests.lock().map_err(|_| "下载状态不可用。")?;
        if tasks.len() >= 8 || tasks.contains_key(&id) {
            return Err("全文任务过多，请稍后重试。".into());
        }
        tasks.insert(
            id.clone(),
            tauri::async_runtime::spawn(async move {
                let _ = sender.send(execute(app, input, progress).await);
            }),
        );
    }
    let result = receiver
        .await
        .unwrap_or_else(|_| Err("全文任务已取消。".into()));
    if let Ok(mut tasks) = state.requests.lock() {
        tasks.remove(&id);
    }
    result
}
#[tauri::command]
pub fn cancel_public_document(request_id: String, state: State<'_, FullTextState>) {
    if let Ok(mut tasks) = state.requests.lock() {
        if let Some(task) = tasks.remove(&request_id) {
            task.abort();
        }
    }
}
#[tauri::command]
pub fn release_downloaded_pdf(app: AppHandle, download_id: String) -> Result<(), String> {
    let path = staged_path(&app, &download_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| "无法清理下载缓存。")?;
    }
    Ok(())
}
#[tauri::command]
pub async fn import_downloaded_pdf(
    app: AppHandle,
    download_id: String,
    name: String,
    target_folder_path: Option<String>,
) -> Result<crate::local_library::LocalLibraryImportResult, String> {
    let source = staged_path(&app, &download_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let mut file = fs::File::open(&source).map_err(|_| "下载缓存已过期，请重新下载。")?;
            crate::local_library::begin_local_library_pdf_import(
                app.clone(),
                download_id.clone(),
                name,
                target_folder_path,
            )?;
            let mut chunk = vec![0; 512 * 1024];
            loop {
                let length = file.read(&mut chunk).map_err(|_| "无法读取下载缓存。")?;
                if length == 0 {
                    break;
                }
                crate::local_library::append_local_library_pdf_import(
                    app.clone(),
                    download_id.clone(),
                    chunk[..length].to_vec(),
                )?;
            }
            crate::local_library::finish_local_library_pdf_import(
                app.clone(),
                download_id.clone(),
                Some("cancel".into()),
            )
        })();
        if result.is_err() {
            let _ = crate::local_library::cancel_local_library_pdf_import(app, download_id);
        }
        let _ = fs::remove_file(source);
        result
    })
    .await
    .map_err(|_| "PDF 导入任务中断。")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_pdf_from_html_and_checks_task_paths() {
        assert!(is_pdf(b"%PDF-1.7"));
        assert!(!is_pdf(b"<html>login</html>"));
        for id in ["../outside", "", "a/b", "C:\\file"] {
            assert!(validate_id(id).is_err());
        }
        assert!(validate_id("safe-123").is_ok());
        assert!(safe_url("https://publisher.example/paper.pdf").is_ok());
        assert!(safe_url("file:///C:/secret").is_err());
    }
}

#[cfg(test)]
mod transfer_tests {
    use super::*;
    fn response_server(body: &'static [u8], slow: bool) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = socket.read(&mut request);
            let extra = if slow { 1024 * 1024 } else { 0 };
            let _ = write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len() + extra
            );
            let _ = socket.write_all(body);
            let _ = socket.flush();
            if slow {
                std::thread::sleep(Duration::from_millis(200));
                let _ = socket.write_all(&vec![0; extra]);
            }
        });
        (address, worker)
    }
    fn target() -> PathBuf {
        std::env::temp_dir().join(format!(
            "liteasy-pdf-{}-{}.pdf",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn streams_complete_pdf_to_disk_and_rejects_truncation() {
        for (body, valid) in [
            (b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF".as_slice(), true),
            (b"%PDF-1.7\ntruncated".as_slice(), false),
        ] {
            let (url, worker) = response_server(body, false);
            let path = target();
            let result = tauri::async_runtime::block_on(async {
                let reply = reqwest::get(&url).await.unwrap();
                receive(
                    reply,
                    path.clone(),
                    "test-id",
                    false,
                    tauri::ipc::Channel::new(|_| Ok(())),
                    url,
                )
                .await
            });
            worker.join().unwrap();
            if valid {
                let response = result.unwrap();
                assert!(response.body_base64.is_empty());
                assert_eq!(response.byte_length, body.len() as u64);
                assert_eq!(
                    response.content_hash,
                    Some(format!("{:x}", Sha256::digest(body)))
                );
                assert_eq!(fs::read(&path).unwrap(), body);
                fs::remove_file(&path).unwrap();
            } else {
                assert!(result.unwrap_err().contains("未完整"));
                assert!(!path.exists());
            }
            assert!(!path.with_extension("part").exists());
        }
    }
    #[test]
    fn probe_stops_after_header_without_creating_a_pdf() {
        let (url, worker) = response_server(b"%PDF-1.7\n", true);
        let path = target();
        let result = tauri::async_runtime::block_on(async {
            receive(
                reqwest::get(&url).await.unwrap(),
                path.clone(),
                "probe",
                true,
                tauri::ipc::Channel::new(|_| Ok(())),
                url,
            )
            .await
            .unwrap()
        });
        worker.join().unwrap();
        assert!(result.download_id.is_none());
        assert!(result.byte_length < 1024 * 1024);
        assert!(!path.exists());
        assert!(!path.with_extension("part").exists());
    }
    #[test]
    fn cancelling_stream_removes_partial_file() {
        let (url, worker) = response_server(b"%PDF-1.7\n", true);
        let path = target();
        tauri::async_runtime::block_on(async {
            let task = tauri::async_runtime::spawn(receive(
                reqwest::get(&url).await.unwrap(),
                path.clone(),
                "cancel",
                false,
                tauri::ipc::Channel::new(|_| Ok(())),
                url,
            ));
            for _ in 0..50 {
                if path.with_extension("part").exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
            assert!(path.with_extension("part").exists());
            task.abort();
            let _ = task.await;
        });
        worker.join().unwrap();
        assert!(!path.exists());
        assert!(!path.with_extension("part").exists());
    }
}
