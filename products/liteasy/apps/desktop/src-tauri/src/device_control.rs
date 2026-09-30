use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openidconnect::reqwest;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use url::Url;

static STORE_LOCK: Mutex<()> = Mutex::new(());
const SERVICE: &str = "com.liteasy.desktop.device-control";

fn endpoint(value: &str) -> Result<String, String> {
    let parsed = Url::parse(value).map_err(|_| "设备服务地址无效。")?;
    let loopback = parsed
        .host_str()
        .and_then(|host| host.parse::<std::net::IpAddr>().ok())
        .is_some_and(|host| host.is_loopback());
    if parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !(parsed.scheme() == "https"
            || (cfg!(debug_assertions) && parsed.scheme() == "http" && loopback))
    {
        return Err("设备服务需要不含凭据的 HTTPS 地址。".into());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}
fn account_scope(endpoint: &str, subject: &str) -> Result<String, String> {
    if subject.is_empty()
        || subject.len() > 512
        || crate::desktop_identity::local_object_scope()? != format!("user:{subject}")
    {
        return Err("请先通过浏览器登录对应账号。".into());
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(format!("{endpoint}\n{subject}"))
    ))
}
fn valid_route(method: &str, route: &str) -> bool {
    match (method, route) {
        ("GET", "devices" | "tasks") => true,
        ("POST", "devices/heartbeat" | "devices/pair-code" | "tasks/claim") => true,
        _ => {
            let parts: Vec<_> = route.split('/').collect();
            let valid_id = parts.get(1).is_some_and(|id| {
                id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
            });
            valid_id
                && ((method == "GET" && parts.len() == 2 && parts[0] == "tasks")
                    || (method == "DELETE" && parts.len() == 2 && parts[0] == "pairs")
                    || (method == "POST"
                        && parts.len() == 3
                        && parts[0] == "tasks"
                        && matches!(parts[2], "start" | "defer" | "progress" | "receipt")))
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Credential {
    device_id: String,
    secret: String,
    registered: bool,
}
fn credential(scope: &str) -> Result<Credential, String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "设备凭据暂不可用。")?;
    let entry = keyring::Entry::new(SERVICE, scope).map_err(|_| "系统凭据存储不可用。")?;
    match entry.get_password() {
        Ok(value) => {
            serde_json::from_str(&value).map_err(|_| "设备凭据损坏，已保留原数据。".into())
        }
        Err(keyring::Error::NoEntry) => {
            let mut bytes = [0_u8; 48];
            SystemRandom::new()
                .fill(&mut bytes)
                .map_err(|_| "无法创建安全设备凭据。")?;
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            let hex: String = bytes[..16]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            let value = Credential {
                device_id: format!(
                    "{}-{}-{}-{}-{}",
                    &hex[..8],
                    &hex[8..12],
                    &hex[12..16],
                    &hex[16..20],
                    &hex[20..]
                ),
                secret: URL_SAFE_NO_PAD.encode(&bytes[16..]),
                registered: false,
            };
            entry
                .set_password(&serde_json::to_string(&value).map_err(|_| "设备凭据无效。")?)
                .map_err(|_| "无法保存设备凭据。")?;
            Ok(value)
        }
        Err(_) => Err("无法读取系统设备凭据。".into()),
    }
}
async fn response(mut response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "设备服务连接中断，任务将保留。")?
    {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("设备服务响应过大。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(format!(
            "设备服务请求未成功（HTTP {}），请检查登录和配对状态。",
            status.as_u16()
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| "设备服务响应无效。".into())
}

#[tauri::command]
pub async fn device_control_request(
    endpoint_url: String,
    subject: String,
    session_id: String,
    method: String,
    route: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let endpoint = endpoint(&endpoint_url)?;
    let scope = account_scope(&endpoint, &subject)?;
    crate::desktop_identity::authorize_device_session(&subject, &session_id)?;
    if session_id.is_empty() || session_id.len() > 16 * 1024 || !valid_route(&method, &route) {
        return Err("设备请求无效。".into());
    }
    if body
        .as_ref()
        .is_some_and(|value| !value.is_object() || value.to_string().len() > 256 * 1024)
    {
        return Err("设备请求内容过大或无效。".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "设备网络连接不可用。")?;
    let mut device = credential(&scope)?;
    if !device.registered {
        response(client.post(format!("{endpoint}/v1/desktop/devices/register")).bearer_auth(&session_id)
            .header("Content-Type", "application/json")
            .body(json!({ "deviceId": device.device_id, "secret": device.secret, "name": "Liteasy 桌面", "capabilities": [] }).to_string())
            .send().await.map_err(|_| "无法连接设备服务。")?).await?;
        account_scope(&endpoint, &subject)?;
        device.registered = true;
        keyring::Entry::new(SERVICE, &scope)
            .map_err(|_| "系统凭据存储不可用。")?
            .set_password(&serde_json::to_string(&device).map_err(|_| "设备凭据无效。")?)
            .map_err(|_| "无法保存设备凭据。")?;
    }
    account_scope(&endpoint, &subject)?;
    crate::desktop_identity::authorize_device_session(&subject, &session_id)?;
    let mut request = client
        .request(
            method.parse().map_err(|_| "设备请求无效。")?,
            format!("{endpoint}/v1/desktop/{route}"),
        )
        .bearer_auth(&session_id)
        .header("X-Liteasy-Device-Id", &device.device_id)
        .header("X-Liteasy-Device-Secret", &device.secret);
    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }
    let value = response(
        request
            .send()
            .await
            .map_err(|_| "设备服务连接中断，任务将保留。")?,
    )
    .await?;
    account_scope(&endpoint, &subject)?;
    Ok(value)
}

#[tauri::command]
pub fn device_control_journal(
    app: AppHandle,
    endpoint_url: String,
    subject: String,
    snapshot: Option<Value>,
) -> Result<Value, String> {
    let endpoint = endpoint(&endpoint_url)?;
    let scope = account_scope(&endpoint, &subject)?;
    let _guard = STORE_LOCK.lock().map_err(|_| "设备记录暂不可用。")?;
    // This directory is independent of user-selected library roots and WebDAV exports.
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "设备记录目录不可用。")?
        .join("device-control");
    fs::create_dir_all(&root).map_err(|_| "无法创建设备记录目录。")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护设备记录目录。")?;
    }
    let path = root.join(format!("{scope}.json"));
    if let Some(value) = snapshot {
        if value.get("version").and_then(Value::as_u64) != Some(1) || !value.is_object() {
            return Err("设备记录版本无效。".into());
        }
        let bytes = serde_json::to_vec(&value).map_err(|_| "设备记录无效。")?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("设备记录过大。".into());
        }
        crate::local_library::write_bytes_atomically(&path, &bytes)?;
        return Ok(value);
    }
    if !path.exists() {
        return Ok(
            json!({ "version": 1, "enabled": false, "allowSummary": false, "pending": null }),
        );
    }
    if fs::metadata(&path).map_err(|_| "无法读取设备记录。")?.len() > 2 * 1024 * 1024 {
        return Err("设备记录过大，已保留原文件。".into());
    }
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取设备记录。")?)
        .map_err(|_| "设备记录损坏，已保留原文件。")?;
    if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("设备记录版本暂不支持。".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_routes_and_credentials_to_the_device_service() {
        for (method, route) in [
            ("GET", "devices"),
            ("GET", "tasks/01234567-0123-4123-8123-0123456789ab"),
            ("POST", "tasks/claim"),
            ("POST", "tasks/01234567-0123-4123-8123-0123456789ab/receipt"),
        ] {
            assert!(valid_route(method, route));
        }
        for route in [
            "../session",
            "devices/register",
            "tasks/claim?other=1",
            "tasks/../../receipt",
            "https://other.example",
        ] {
            assert!(!valid_route("POST", route));
        }
        assert_eq!(
            endpoint("https://api.example/").unwrap(),
            "https://api.example"
        );
        for value in [
            "https://user:secret@api.example",
            "https://api.example?secret=x",
            "http://external.example",
            "file:///tmp/api",
        ] {
            assert!(endpoint(value).is_err());
        }
    }
}
