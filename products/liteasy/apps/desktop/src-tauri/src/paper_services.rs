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
fn credential(config: &PaperServiceConfig) -> Result<Entry, String> {
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
}
#[tauri::command]
pub async fn request_paper_service(
    config: PaperServiceConfig,
    url: String,
    method: String,
    body_base64: Option<String>,
    content_type: Option<String>,
    authenticate: bool,
) -> Result<ServiceResponse, String> {
    let base = validate(&config)?;
    let mut target = Url::parse(&url).map_err(|_| "请求地址无效。")?;
    valid_url(&target)?;
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
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
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
    let mut response = request
        .send()
        .await
        .map_err(|_| "论文服务连接失败，请检查网络或代理。")?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "论文服务连接中断，可重试。")?
    {
        if bytes.len() + chunk.len() > 200 * 1024 * 1024 {
            return Err("响应超过大小限制。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(ServiceResponse {
        status,
        body_base64: STANDARD.encode(bytes),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
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
