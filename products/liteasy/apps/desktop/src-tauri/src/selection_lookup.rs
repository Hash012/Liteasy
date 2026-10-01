use keyring::Entry;
use openidconnect::reqwest;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;
use url::Url;

const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Deserialize)]
pub struct LookupConfig {
    provider: String,
    endpoint: Option<String>,
}

#[derive(Default)]
pub struct SelectionLookupState {
    requests: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Serialize)]
pub struct LookupResponse {
    status: u16,
    body: String,
}

fn translation_endpoint(config: &LookupConfig) -> Result<Url, String> {
    if config.provider != "libretranslate" {
        return Err("此查询服务不需要密钥。".into());
    }
    let url = Url::parse(config.endpoint.as_deref().unwrap_or("").trim())
        .map_err(|_| "翻译服务地址无效。")?;
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("翻译服务须使用 HTTPS，本机可用 HTTP；地址不能包含密钥。".into());
    }
    Ok(url)
}

fn credential(config: &LookupConfig) -> Result<Entry, String> {
    let scope = translation_endpoint(config)?
        .as_str()
        .trim_end_matches('/')
        .to_string();
    Entry::new(
        "com.liteasy.desktop.selection-lookup",
        &format!("{:x}", Sha256::digest(scope.as_bytes())),
    )
    .map_err(|_| "系统凭据库不可用。".into())
}

#[tauri::command]
pub fn save_selection_lookup_key(config: LookupConfig, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() || api_key.len() > 8192 || api_key.contains(['\r', '\n']) {
        return Err("请填写有效的翻译服务密钥。".into());
    }
    credential(&config)?
        .set_password(api_key.trim())
        .map_err(|_| "密钥保存失败。".into())
}

#[tauri::command]
pub fn has_selection_lookup_key(config: LookupConfig) -> Result<bool, String> {
    match credential(&config)?.get_password() {
        Ok(key) => Ok(!key.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("读取凭据失败。".into()),
    }
}

#[tauri::command]
pub fn delete_selection_lookup_key(config: LookupConfig) -> Result<(), String> {
    match credential(&config)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("删除凭据失败。".into()),
    }
}

fn request_url(config: &LookupConfig, text: &str) -> Result<Url, String> {
    if text.trim().is_empty() || text.chars().count() > 1000 {
        return Err("请选中不超过 1,000 字符的单词、短语或短句。".into());
    }
    match config.provider.as_str() {
        "bing" => {
            let mut url = Url::parse("https://cn.bing.com/dict/search").unwrap();
            url.query_pairs_mut().append_pair("q", text);
            Ok(url)
        }
        "youdao" | "free-dictionary" => {
            let mut url = Url::parse(if config.provider == "youdao" {
                "https://www.youdao.com/w/"
            } else {
                "https://api.dictionaryapi.dev/api/v2/entries/en/"
            })
            .unwrap();
            {
                let mut path = url.path_segments_mut().map_err(|_| "查询地址无效。")?;
                path.pop_if_empty().push(text);
                if config.provider == "youdao" {
                    path.push("");
                }
            }
            Ok(url)
        }
        "libretranslate" => {
            let mut url = translation_endpoint(config)?;
            url.path_segments_mut()
                .map_err(|_| "查询地址无效。")?
                .pop_if_empty()
                .push("translate");
            Ok(url)
        }
        _ => Err("查询服务无效。".into()),
    }
}

fn valid_language(value: &str, target: bool) -> bool {
    (2..=16).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphabetic() || byte == b'-')
        && (!target || value != "auto")
}

async fn execute_request(
    config: LookupConfig,
    text: String,
    source: String,
    target: String,
) -> Result<LookupResponse, String> {
    let url = request_url(&config, &text)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Liteasy")
        .build()
        .map_err(|_| "查询网络初始化失败。")?;
    let request = if config.provider == "libretranslate" {
        let mut body = json!({ "q": text, "source": source, "target": target, "format": "text" });
        match credential(&config)?.get_password() {
            Ok(key) => {
                body["api_key"] = json!(key);
            }
            Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("读取翻译服务凭据失败。".into()),
        }
        client
            .post(url)
            .header("Content-Type", "application/json")
            .body(body.to_string())
    } else {
        client.get(url)
    };
    let mut response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "查询超时，请重试或切换服务。"
        } else {
            "无法连接查询服务，请检查网络或切换服务。"
        }
    })?;
    if response
        .content_length()
        .is_some_and(|size| size > RESPONSE_LIMIT as u64)
    {
        return Err("查询结果过大，请缩小选区。".into());
    }
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "查询连接中断，请重试。")?
    {
        if body.len() + chunk.len() > RESPONSE_LIMIT {
            return Err("查询结果过大，请缩小选区。".into());
        }
        body.extend_from_slice(&chunk);
    }
    // Never return upstream authentication errors which may contain an echoed key.
    Ok(LookupResponse {
        status,
        body: if status == 200 {
            String::from_utf8_lossy(&body).into_owned()
        } else {
            String::new()
        },
    })
}

#[tauri::command]
pub async fn request_selection_lookup(
    config: LookupConfig,
    text: String,
    source_language: String,
    target_language: String,
    request_id: String,
    state: State<'_, SelectionLookupState>,
) -> Result<LookupResponse, String> {
    request_url(&config, &text)?;
    if !valid_language(&source_language, false)
        || !valid_language(&target_language, true)
        || request_id.is_empty()
        || request_id.len() > 128
    {
        return Err("查询语言或请求标识无效。".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let mut requests = state.requests.lock().map_err(|_| "查询状态不可用。")?;
        if requests.contains_key(&request_id) || requests.len() >= 16 {
            return Err("查询过于频繁，请稍后重试。".into());
        }
        let task = tauri::async_runtime::spawn(async move {
            let _ =
                sender.send(execute_request(config, text, source_language, target_language).await);
        });
        requests.insert(request_id.clone(), task);
    }
    let result = receiver
        .await
        .unwrap_or_else(|_| Err("查询已取消。".into()));
    if let Ok(mut requests) = state.requests.lock() {
        requests.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn cancel_selection_lookup_request(request_id: String, state: State<'_, SelectionLookupState>) {
    if let Ok(mut requests) = state.requests.lock() {
        if let Some(task) = requests.remove(&request_id) {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queries_stay_on_the_provider_and_encode_untrusted_selection() {
        for provider in ["bing", "youdao", "free-dictionary"] {
            let config = LookupConfig {
                provider: provider.into(),
                endpoint: Some("https://evil.example".into()),
            };
            let url = request_url(&config, "word/?key=x#fragment").unwrap();
            assert!(!url.as_str().contains("evil.example"));
            assert!(url.fragment().is_none());
            if provider == "bing" {
                assert_eq!(url.query_pairs().next().unwrap().1, "word/?key=x#fragment");
            } else {
                assert!(url.query().is_none());
                assert!(url.path().contains("%2F"));
            }
        }
    }
    #[test]
    fn endpoints_and_languages_are_validated_before_network_or_credentials() {
        for endpoint in [
            "http://remote.example",
            "https://user:key@example.com",
            "https://example.com?api_key=x",
            "https://example.com#key",
        ] {
            assert!(translation_endpoint(&LookupConfig {
                provider: "libretranslate".into(),
                endpoint: Some(endpoint.into())
            })
            .is_err());
        }
        for endpoint in [
            "http://localhost:5000",
            "http://127.0.0.1:5000/api",
            "https://translate.example/api",
        ] {
            let config = LookupConfig {
                provider: "libretranslate".into(),
                endpoint: Some(endpoint.into()),
            };
            assert!(request_url(&config, "hello")
                .unwrap()
                .path()
                .ends_with("/translate"));
        }
        assert!(!valid_language("auto", true));
        assert!(!valid_language("en\r\nKey:x", false));
        assert!(valid_language("zh-Hans", true));
        assert!(request_url(
            &LookupConfig {
                provider: "unknown".into(),
                endpoint: None
            },
            "hello"
        )
        .is_err());
    }
}
