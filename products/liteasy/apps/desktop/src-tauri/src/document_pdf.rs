//! Local report driver. Static HTML only; ephemeral WebView2 profile, no remote assets.
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPdf {
    content: String,
    renderer: String,
}

#[tauri::command]
pub fn document_pdf_capability() -> bool {
    cfg!(windows)
}

#[tauri::command]
pub fn cancel_document_pdf(app: AppHandle, request_id: String) -> Result<(), String> {
    validate_id(&request_id)?;
    if let Some(window) = app.get_webview_window(&format!("document-export-{request_id}")) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("导出任务标识无效。".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn render_document_pdf(
    app: AppHandle,
    request_id: String,
    html: String,
) -> Result<RenderedPdf, String> {
    validate_id(&request_id)?;
    // NavigateToString has a documented 2 MiB limit. Refuse; never drop attachments to fit it.
    if html.len() > 2 * 1024 * 1024 || !html.starts_with("<!doctype html>") {
        return Err("此 PDF 驱动单次静态文档限制为 2 MiB，请缩减图片或拆分导出。".into());
    }
    #[cfg(not(windows))]
    {
        let _ = (app, request_id, html);
        Err("此平台尚未提供后台 PDF 驱动，请使用系统打印或导出 HTML/DOCX。".into())
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || windows_render(app, request_id, html))
            .await
            .map_err(|_| "PDF 任务意外中断。".to_string())?
    }
}

#[cfg(windows)]
fn windows_render(app: AppHandle, request_id: String, html: String) -> Result<RenderedPdf, String> {
    use base64::Engine;
    use std::{
        sync::{mpsc, Mutex},
        time::{Duration, Instant},
    };
    use webview2_com::{
        take_pwstr, DocumentTitleChangedEventHandler, ExecuteScriptCompletedHandler,
        Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler,
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING, PWSTR};
    static RENDER_LOCK: Mutex<()> = Mutex::new(());
    let _guard = RENDER_LOCK
        .try_lock()
        .map_err(|_| "已有 PDF 正在生成，请稍后重试。")?;
    let label = format!("document-export-{request_id}");
    let root = crate::data_location::root(&app)?
        .join("document-export-jobs")
        .join(&request_id);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let output = root.join("report.pdf");
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let (created_tx, created_rx) = mpsc::channel();
    let handle = app.clone();
    let window_label = label.clone();
    let profile = root.join("webview");
    // Put the host CSP first. ExecuteScript below is trusted native readiness code, not document content.
    let html = html.replacen("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none';script-src 'none';img-src data:;style-src 'unsafe-inline';font-src data:;base-uri 'none';form-action 'none'\">", 1);
    let html = html.replacen(
        "<body>",
        &format!("<body data-liteasy-export-job=\"{request_id}\">"),
        1,
    );
    let trusted_navigation = format!(
        "data:text/html;charset=utf-8;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(html.as_bytes())
    );
    let job_marker = serde_json::to_string(&request_id).map_err(|e| e.to_string())?;
    if !html.contains("<head><meta http-equiv=\"Content-Security-Policy\"") {
        return Err("静态文档缺少受控 head。".into());
    }
    let ready = format!("liteasy-export-ready-{request_id}");
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let window = tauri::WebviewWindowBuilder::new(&handle, &window_label, tauri::WebviewUrl::External("about:blank".parse().unwrap()))
                .visible(false).incognito(true).data_directory(profile).on_navigation(move |url| {
                    url.as_str() == "about:blank" || url.as_str() == trusted_navigation
                })
                .build().map_err(|e| format!("无法启动离线 PDF 驱动：{e}"))?;
            window.with_webview(move |webview| {
                let setup = (|| -> windows::core::Result<()> { unsafe {
                    let core = webview.controller().CoreWebView2()?;
                    let environment = core.cast::<ICoreWebView2_2>()?.Environment()?;
                    let mut version = PWSTR::null(); environment.BrowserVersionString(&mut version)?;
                    let version = take_pwstr(version);
                    let settings = environment.cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
                    settings.SetShouldPrintBackgrounds(true)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    settings.SetScaleFactor(1.0)?;
                    settings.SetPageWidth(210.0 / 25.4)?; settings.SetPageHeight(297.0 / 25.4)?;
                    // Paper margins live in the shared @page rule; do not apply them a second time here.
                    settings.SetMarginTop(0.0)?; settings.SetMarginBottom(0.0)?;
                    settings.SetMarginLeft(0.0)?; settings.SetMarginRight(0.0)?;
                    let done = tx.clone(); let title_ready = ready.clone(); let path = HSTRING::from(output.to_string_lossy().as_ref());
                    let mut started = false;
                    let title = DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
                        if started { return Ok(()); }
                        if let Some(sender) = sender {
                            let mut title = PWSTR::null(); sender.DocumentTitle(&mut title)?;
                            let title = take_pwstr(title);
                            if title == "liteasy-export-failed" { let _ = done.send(Err("图片、字体或布局未就绪。".into())); return Ok(()); }
                            if title != title_ready { return Ok(()); }
                            started = true;
                            let complete = done.clone(); let engine = version.clone();
                            let callback = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
                                let outcome = result.map_err(|e| format!("PDF 排版失败：{e}")).and_then(|_| if success { Ok(format!("WebView2/{engine}")) } else { Err("PDF 排版未完成。".into()) });
                                let _ = complete.send(outcome); Ok(())
                            }));
                            if let Err(e) = sender.cast::<ICoreWebView2_7>()?.PrintToPdf(&path, &settings, &callback) { let _ = done.send(Err(format!("无法打印 PDF：{e}"))); }
                        }
                        Ok(())
                    }));
                    let mut token = 0; core.add_DocumentTitleChanged(&title, &mut token)?;
                    let ready_script = format!(r#"(async()=>{{if(document.body?.getAttribute('data-liteasy-export-job')!=={})return;try{{await document.fonts.ready;await Promise.all(Array.from(document.images).map(image=>image.decode()));let previous='',stable=0;for(let i=0;i<240&&stable<3;i++){{await new Promise(resolve=>setTimeout(resolve,16));let current=document.body.scrollHeight+':'+document.body.scrollWidth;stable=current===previous?stable+1:0;previous=current;}}if(stable<3)throw Error('layout');document.title={};}}catch{{document.title='liteasy-export-failed';}}}})()"#, job_marker, serde_json::to_string(&ready).unwrap());
                    let failure = tx.clone();
                    let navigation = NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                        if let Some(sender) = sender {
                            let callback = ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())));
                            if let Err(e) = sender.ExecuteScript(&HSTRING::from(&ready_script), &callback) { let _ = failure.send(Err(format!("无法等待文档资源：{e}"))); }
                        }
                        Ok(())
                    }));
                    core.add_NavigationCompleted(&navigation, &mut token)?;
                    core.NavigateToString(&HSTRING::from(html))?;
                    Ok(())
                }})();
                if let Err(e) = setup { let _ = tx.send(Err(format!("PDF 驱动不可用：{e}"))); }
            }).map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = created_tx.send(result);
    }).map_err(|e| e.to_string())?;
    let result = (|| -> Result<RenderedPdf, String> {
        created_rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "PDF 驱动启动超时。")??;
        let start = Instant::now();
        let renderer = loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(value) => break value?,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("PDF 任务意外中断。".into())
                }
                Err(_) => {}
            }
            if app.get_webview_window(&label).is_none() {
                return Err("PDF 导出已取消。".into());
            }
            if start.elapsed() > Duration::from_secs(45) {
                return Err("PDF 资源或排版超时，未发布文件。".into());
            }
        };
        let bytes = std::fs::read(root.join("report.pdf")).map_err(|e| e.to_string())?;
        #[cfg(debug_assertions)]
        if std::env::var("LITEASY_EXPORT_QA").as_deref() == Ok("1") {
            // Explicit QA in an isolated development profile only. Never dump normal-account PDFs.
            if let Some(profile) = crate::local_dev::profile_root()
                .filter(|_| crate::local_dev::recovery_scope().is_none())
            {
                use std::io::Write;
                let directory = profile.join("export-qa");
                std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
                let mut file = std::fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(directory.join(format!("{request_id}.pdf")))
                    .map_err(|e| e.to_string())?;
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| e.to_string())?;
            }
        }
        if bytes.len() > 64 * 1024 * 1024
            || !bytes.starts_with(b"%PDF-")
            || !bytes.windows(5).rev().take(1024).any(|w| w == b"%%EOF")
        {
            return Err("PDF 产物结构无效，未发布文件。".into());
        }
        Ok(RenderedPdf {
            content: base64::engine::general_purpose::STANDARD.encode(bytes),
            renderer,
        })
    })();
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    // Windows may keep profile handles briefly; failed cleanup does not publish a partial document.
    let _ = std::fs::remove_dir_all(root);
    result
}
