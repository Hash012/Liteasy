use keyring::Entry;
use openidconnect::reqwest;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{ipc::Channel, State};
use url::Url;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectModelConfig {
    provider: String,
    endpoint: String,
    model: String,
    protocol: String,
}

#[derive(Default)]
pub struct DirectModelState {
    requests: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

fn normalized_endpoint(config: &DirectModelConfig) -> Result<String, String> {
    let url = Url::parse(config.endpoint.trim()).map_err(|_| "请填写有效的 API 基础地址。")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址须使用 HTTPS，且不能包含密钥或查询参数；本机可用 HTTP。".into());
    }
    if config.provider.is_empty()
        || config.provider.len() > 64
        || !config
            .provider
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || config.model.trim().is_empty()
        || !matches!(config.protocol.as_str(), "openai" | "anthropic")
    {
        return Err("API 服务商、模型或协议配置无效。".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn credential_name(config: &DirectModelConfig) -> Result<String, String> {
    let scope = format!("{}:{}", config.provider, normalized_endpoint(config)?);
    Ok(format!("{:x}", Sha256::digest(scope.as_bytes())))
}

fn credential(config: &DirectModelConfig) -> Result<Entry, String> {
    Entry::new("com.liteasy.desktop.model-api", &credential_name(config)?)
        .map_err(|_| "系统凭据库不可用，无法安全保存或读取 API key。".into())
}

#[tauri::command]
pub fn has_direct_model_key(config: DirectModelConfig) -> Result<bool, String> {
    match credential(&config)?.get_password() {
        Ok(value) => Ok(!value.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("无法读取系统凭据库。".into()),
    }
}

#[tauri::command]
pub fn save_direct_model_key(config: DirectModelConfig, api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if key.is_empty() || key.len() > 8192 || key.contains(['\r', '\n']) {
        return Err("请填写有效的 API key。".into());
    }
    credential(&config)?
        .set_password(key)
        .map_err(|_| "API key 未能保存到系统凭据库。".into())
}

#[tauri::command]
pub fn delete_direct_model_key(config: DirectModelConfig) -> Result<(), String> {
    match credential(&config)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法从系统凭据库删除 API key。".into()),
    }
}

fn http_error(status: u16) -> String {
    let detail = match status {
        401 | 403 => "密钥无效或没有模型访问权限",
        429 => "额度不足或请求过于频繁",
        404 => "请检查 API 地址和模型 ID",
        400 => "请检查模型、API 协议和结构化输出设置",
        _ => "服务暂时不可用，请稍后重试",
    };
    format!("API 请求失败（HTTP {status}）：{detail}。")
}

async fn execute_request(
    config: DirectModelConfig,
    body: Value,
    chunks: Channel<Vec<u8>>,
) -> Result<String, String> {
    let endpoint = normalized_endpoint(&config)?;
    let url = Url::parse(&endpoint).map_err(|_| "API 地址无效。")?;
    let local_ollama = config.provider == "ollama"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    let key = if local_ollama {
        None
    } else {
        Some(
            credential(&config)?
                .get_password()
                .map_err(|_| "请先在设置 → AI 接入中保存 API key。")?,
        )
    };
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化 API 连接。")?;
    let suffix = if config.protocol == "anthropic" {
        "messages"
    } else {
        "chat/completions"
    };
    let mut request = client
        .post(format!("{endpoint}/{suffix}"))
        .header("Content-Type", "application/json")
        .body(body.to_string());
    if config.protocol == "anthropic" {
        request = request.header("anthropic-version", "2023-06-01");
        if let Some(key) = key {
            request = request.header("x-api-key", key);
        }
    } else if let Some(key) = key {
        request = if config.provider == "azure" {
            request.header("api-key", key)
        } else {
            request.bearer_auth(key)
        };
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "无法连接 API，请检查网络、代理和 API 地址。")?;
    if !response.status().is_success() {
        return Err(http_error(response.status().as_u16()));
    }
    let streaming = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let mut result = Vec::new();
    let mut received = 0usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "API 连接中断，请重试。")?
    {
        received += chunk.len();
        if received > 16 * 1024 * 1024 {
            return Err("API 响应过大，请缩小生成范围。".into());
        }
        if streaming {
            chunks
                .send(chunk.to_vec())
                .map_err(|_| "生成接收窗口已关闭。")?;
        } else {
            result.extend_from_slice(&chunk);
        }
    }
    if streaming {
        chunks
            .send(Vec::new())
            .map_err(|_| "生成接收窗口已关闭。")?;
    }
    String::from_utf8(result).map_err(|_| "API 响应不是有效的文本。".into())
}

#[tauri::command]
pub async fn request_direct_model(
    config: DirectModelConfig,
    body: Value,
    request_id: String,
    chunks: Channel<Vec<u8>>,
    state: State<'_, DirectModelState>,
) -> Result<String, String> {
    normalized_endpoint(&config)?;
    if request_id.len() > 128 || body.to_string().len() > 8 * 1024 * 1024 {
        return Err("API 请求过大或请求标识无效。".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let mut requests = state.requests.lock().map_err(|_| "API 请求状态不可用。")?;
        if requests.contains_key(&request_id) {
            return Err("API 请求标识重复。".into());
        }
        let task = tauri::async_runtime::spawn(async move {
            let _ = sender.send(execute_request(config, body, chunks).await);
        });
        requests.insert(request_id.clone(), task);
    }
    let result = receiver
        .await
        .unwrap_or_else(|_| Err("已停止生成。".into()));
    if let Ok(mut requests) = state.requests.lock() {
        requests.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn cancel_direct_model_request(request_id: String, state: State<'_, DirectModelState>) {
    if let Ok(mut requests) = state.requests.lock() {
        if let Some(task) = requests.remove(&request_id) {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    fn local_server(status: &str, response: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{response}", response.len());
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut headers = String::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                headers.push_str(&line);
            }
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).unwrap();
            socket.write_all(response.as_bytes()).unwrap();
            format!("{headers}\n{}", String::from_utf8(body).unwrap())
        });
        (endpoint, handle)
    }

    #[test]
    fn streams_real_http_bytes_without_an_account_or_key_for_local_ollama() {
        let response =
            "data: {\"choices\":[{\"delta\":{\"content\":\"测试\"}}]}\n\ndata: [DONE]\n\n";
        let (endpoint, server) = local_server("200 OK", response);
        let mut cfg = config(&endpoint);
        cfg.provider = "ollama".into();
        let received = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let result_chunks = received.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                result_chunks
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        let result = tauri::async_runtime::block_on(execute_request(
            cfg,
            serde_json::json!({ "model": "test-model", "stream": true, "messages": [] }),
            channel,
        ))
        .unwrap();
        assert!(result.is_empty());
        let chunks = received.lock().unwrap();
        assert_eq!(chunks.last().unwrap(), &Vec::<u8>::new());
        assert_eq!(String::from_utf8(chunks.concat()).unwrap(), response);
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /v1/chat/completions"));
        assert!(!request.to_lowercase().contains("authorization:"));
    }

    #[test]
    fn returns_sanitized_http_errors_without_echoing_upstream_secrets() {
        let (endpoint, server) = local_server("401 Unauthorized", "echoed-secret-from-upstream");
        let mut cfg = config(&endpoint);
        cfg.provider = "ollama".into();
        let error = tauri::async_runtime::block_on(execute_request(
            cfg,
            serde_json::json!({ "stream": false }),
            Channel::new(|_| Ok(())),
        ))
        .unwrap_err();
        assert!(error.contains("401"));
        assert!(!error.contains("echoed-secret"));
        server.join().unwrap();
    }

    fn config(endpoint: &str) -> DirectModelConfig {
        DirectModelConfig {
            provider: "openai".into(),
            endpoint: endpoint.into(),
            model: "test-model".into(),
            protocol: "openai".into(),
        }
    }
    #[test]
    fn rejects_credentials_and_insecure_remote_endpoints() {
        for endpoint in [
            "http://api.example.com/v1",
            "https://user:key@example.com/v1",
            "https://api.example.com/v1?key=secret",
            "file:///tmp/model",
        ] {
            assert!(normalized_endpoint(&config(endpoint)).is_err());
        }
        assert!(normalized_endpoint(&config("http://127.0.0.1:11434/v1")).is_ok());
        assert!(normalized_endpoint(&config("http://[::1]:11434/v1")).is_ok());
    }
    #[test]
    fn binds_credentials_to_provider_and_normalized_endpoint() {
        let a = config("https://api.example.com/v1/");
        let mut b = config("https://api.example.com/v1");
        assert_eq!(credential_name(&a).unwrap(), credential_name(&b).unwrap());
        b.endpoint = "https://other.example.com/v1".into();
        assert_ne!(credential_name(&a).unwrap(), credential_name(&b).unwrap());
        b.endpoint = a.endpoint.clone();
        b.provider = "custom".into();
        assert_ne!(credential_name(&a).unwrap(), credential_name(&b).unwrap());
    }
}
