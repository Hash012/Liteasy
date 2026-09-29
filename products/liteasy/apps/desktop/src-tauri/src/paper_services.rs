use base64::{engine::general_purpose::STANDARD, Engine};
use keyring::Entry;
use openidconnect::reqwest;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use url::Url;
#[derive(Deserialize)]
pub struct PaperServiceConfig {
    provider: String,
    endpoint: String,
}
fn validate(config: &PaperServiceConfig) -> Result<Url, String> {
    if !matches!(
        config.provider.as_str(),
        "crossref" | "openalex" | "semantic-scholar" | "mineru"
    ) {
        return Err("未知论文服务。".into());
    }
    let url = Url::parse(&config.endpoint).map_err(|_| "论文服务地址无效。")?;
    valid_url(&url)?;
    if url.query().is_some() {
        return Err("服务地址不能包含查询参数或密钥。".into());
    }
    Ok(url)
}
fn valid_url(url: &Url) -> Result<(), String> {
    if (url.scheme() != "https"
        && !(url.scheme() == "http"
            && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("论文服务须使用 HTTPS，本机服务可用 HTTP。".into());
    }
    Ok(())
}
fn validate_public_redirect(url: &Url, previous_count: usize) -> Result<(), &'static str> {
    if previous_count > 5 {
        return Err("全文下载重定向次数过多。");
    }
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("全文下载重定向地址不安全。");
    }
    Ok(())
}
pub(crate) fn credential(config: &PaperServiceConfig) -> Result<Entry, String> {
    let endpoint = validate(config)?;
    let scope = format!(
        "{}:{}",
        config.provider,
        endpoint.as_str().trim_end_matches('/')
    );
    Entry::new(
        "com.liteasy.desktop.paper-services",
        &format!("{:x}", Sha256::digest(scope.as_bytes())),
    )
    .map_err(|_| "系统凭据库不可用。".into())
}
#[tauri::command]
pub fn save_paper_service_key(config: PaperServiceConfig, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() || api_key.len() > 8192 || api_key.contains(['\r', '\n']) {
        return Err("API key 无效。".into());
    }
    credential(&config)?
        .set_password(api_key.trim())
        .map_err(|_| "密钥保存失败。".into())
}
#[tauri::command]
pub fn has_paper_service_key(config: PaperServiceConfig) -> Result<bool, String> {
    match credential(&config)?.get_password() {
        Ok(key) => Ok(!key.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("读取凭据失败。".into()),
    }
}
#[tauri::command]
pub fn delete_paper_service_key(config: PaperServiceConfig) -> Result<(), String> {
    match credential(&config)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("删除凭据失败。".into()),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceResponse {
    status: u16,
    body_base64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_url: Option<String>,
}
#[tauri::command]
pub async fn request_paper_service(
    config: PaperServiceConfig,
    url: String,
    method: String,
    body_base64: Option<String>,
    content_type: Option<String>,
    authenticate: bool,
    max_response_bytes: Option<usize>,
    timeout_ms: Option<u64>,
    follow_public_redirects: Option<bool>,
) -> Result<ServiceResponse, String> {
    if follow_public_redirects.unwrap_or(false) && authenticate {
        return Err("携带凭据的论文服务请求不能跟随重定向。".into());
    }
    if follow_public_redirects.unwrap_or(false)
        && (method != "GET" || body_base64.is_some() || content_type.is_some())
    {
        return Err("公开全文重定向仅支持不携带正文的 GET 请求。".into());
    }
    let timeout = timeout_ms.unwrap_or(120_000);
    if timeout == 0 || timeout > 120_000 {
        return Err("请求超时设置无效。".into());
    }
    let response_limit = max_response_bytes.unwrap_or(200 * 1024 * 1024);
    if response_limit == 0 || response_limit > 200 * 1024 * 1024 {
        return Err("响应大小限制无效。".into());
    }
    let base = validate(&config)?;
    let mut target = Url::parse(&url).map_err(|_| "请求地址无效。")?;
    valid_url(&target)?;
    if follow_public_redirects.unwrap_or(false) {
        validate_public_redirect(&target, 0)?;
    }
    if authenticate
        && (base.origin() != target.origin()
            || !target.path().starts_with(base.path().trim_end_matches('/')))
    {
        return Err("禁止向其他服务发送密钥。".into());
    }
    if !matches!(method.as_str(), "GET" | "POST" | "PUT") {
        return Err("请求方法无效。".into());
    }
    let key = if authenticate {
        match credential(&config)?.get_password() {
            Ok(key) => Some(key),
            Err(keyring::Error::NoEntry) => None,
            Err(_) => return Err("读取凭据失败。".into()),
        }
    } else {
        None
    };
    if config.provider == "openalex" {
        if let Some(ref key) = key {
            target.query_pairs_mut().append_pair("api_key", key);
        }
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(timeout.min(15_000)))
        .timeout(Duration::from_millis(timeout))
        .referer(false)
        .redirect(if follow_public_redirects.unwrap_or(false) {
            reqwest::redirect::Policy::custom(|attempt| {
                match validate_public_redirect(attempt.url(), attempt.previous().len()) {
                    Ok(()) => attempt.follow(),
                    Err(error) => attempt.error(error),
                }
            })
        } else {
            reqwest::redirect::Policy::none()
        })
        .build()
        .map_err(|_| "网络初始化失败。")?;
    let mut request = client.request(method.parse().map_err(|_| "请求方法无效。")?, target);
    if let Some(key) = key {
        request = match config.provider.as_str() {
            "semantic-scholar" => request.header("x-api-key", key),
            "crossref" => request.header("Crossref-Plus-API-Token", format!("Bearer {key}")),
            "openalex" => request,
            _ => request.bearer_auth(key),
        };
    }
    if let Some(value) = content_type {
        request = request.header("Content-Type", value);
    }
    if let Some(body) = body_base64 {
        let bytes = STANDARD.decode(body).map_err(|_| "请求数据无效。")?;
        if bytes.len() > 200 * 1024 * 1024 {
            return Err("论文超过 200 MB。".into());
        }
        request = request.body(bytes);
    }
    let mut response = request.send().await.map_err(|error| {
        if error.is_redirect() {
            "全文下载跳转不安全或次数过多，可从来源页面获取 PDF。"
        } else {
            "论文服务连接失败，请检查网络或代理。"
        }
    })?;
    let status = response.status().as_u16();
    // Authenticated OpenAlex URLs can contain a key read from the OS keyring.
    // Only public downloads need a final URL; never return that key to the renderer.
    let final_url = (!authenticate).then(|| response.url().to_string());
    if response
        .content_length()
        .is_some_and(|size| size > response_limit as u64)
    {
        return Err("响应超过大小限制。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "论文服务连接中断，可重试。")?
    {
        if bytes.len() + chunk.len() > response_limit {
            return Err("响应超过大小限制。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(ServiceResponse {
        status,
        body_base64: STANDARD.encode(bytes),
        final_url,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_pdf_redirects_reject_downgrades_credentials_and_excess_hops() {
        for unsafe_url in [
            "http://publisher.example/paper.pdf",
            "http://127.0.0.1/paper.pdf",
            "https://user:password@publisher.example/paper.pdf",
            "https://publisher.example/paper.pdf#fragment",
            "file:///tmp/paper.pdf",
        ] {
            assert!(validate_public_redirect(&Url::parse(unsafe_url).unwrap(), 1).is_err());
        }
        let public_url =
            Url::parse("https://cdn.publisher.example/paper.pdf?download=true").unwrap();
        assert!(validate_public_redirect(&public_url, 5).is_ok());
        assert!(validate_public_redirect(&public_url, 6).is_err());
    }

    #[test]
    fn public_redirects_never_request_credentials_or_forward_uploaded_documents() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        for (authenticate, method, body, expected_error) in [
            (true, "GET", None, "凭据"),
            (false, "POST", None, "GET"),
            (
                false,
                "GET",
                Some(STANDARD.encode(b"private document")),
                "GET",
            ),
        ] {
            let result = runtime.block_on(request_paper_service(
                PaperServiceConfig {
                    provider: "crossref".into(),
                    endpoint: "https://publisher.example".into(),
                },
                "https://publisher.example/paper.pdf".into(),
                method.into(),
                body,
                None,
                authenticate,
                Some(1024),
                Some(1),
                Some(true),
            ));
            assert!(matches!(result, Err(error) if error.contains(expected_error)));
        }
    }

    #[test]
    fn bounds_native_responses_without_requiring_content_length() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        for limit in [10, 12] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 4096];
                let length = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]).to_lowercase();
                assert!(!request.contains("authorization:"));
                assert!(!request.contains("crossref-plus-api-token:"));
                assert!(!request.contains("cookie:"));
                stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nc\r\nabcdefghijkl\r\n0\r\n\r\n").unwrap();
            });
            let result = runtime.block_on(request_paper_service(
                PaperServiceConfig {
                    provider: "crossref".into(),
                    endpoint: endpoint.clone(),
                },
                endpoint,
                "GET".into(),
                None,
                None,
                false,
                Some(limit),
                None,
                None,
            ));
            server.join().unwrap();
            match result {
                Ok(response) => {
                    assert_eq!(limit, 12);
                    assert_eq!(
                        STANDARD.decode(response.body_base64).unwrap(),
                        b"abcdefghijkl"
                    );
                }
                Err(error) => {
                    assert_eq!(limit, 10);
                    assert!(error.contains("大小限制"));
                }
            }
        }
    }

    #[test]
    fn rejects_credential_urls_and_nonlocal_http() {
        for endpoint in [
            "http://example.com",
            "https://key@example.com",
            "https://example.com?token=abc",
        ] {
            assert!(validate(&PaperServiceConfig {
                provider: "mineru".into(),
                endpoint: endpoint.into()
            })
            .is_err());
        }
        assert!(validate(&PaperServiceConfig {
            provider: "mineru".into(),
            endpoint: "http://127.0.0.1:8000".into()
        })
        .is_ok());
    }
}
