//! ChatGPT-plan OAuth is separate from Liteasy identity and API-key credentials.
//! Tokens stay in the OS credential facility and never enter renderer responses.
use chrono::Utc;
use keyring::Entry;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreProviderMetadata, CoreTokenResponse,
};
use openidconnect::{
    reqwest, AccessTokenHash, AuthUrl, AuthorizationCode, ClientId, CsrfToken, IssuerUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, RedirectUrl, RefreshToken, Scope, TokenResponse,
    TokenUrl,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use url::Url;

const ISSUER: &str = "https://auth.openai.com";
const API: &str = "https://api.openai.com/v1";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const SCOPES: &[&str] = &[
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    "chatgpt.tokens.use.direct",
];
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[derive(Default)]
pub struct ChatgptPlanState {
    pub epoch: AtomicU64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAccount {
    pub id: String,
    pub name: String,
    pub email: String,
    pub client_id: String,
    pub plan_usage_enabled: bool,
    pub inference_verified: bool,
}
#[derive(Deserialize, Serialize)]
struct Credentials {
    subject: String,
    client_id: String,
    id_token: String,
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    scopes: Vec<String>,
    account: PlanAccount,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Accounts {
    active_account: Option<String>,
    accounts: Vec<PlanAccount>,
}
fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn guard(scope: &str) -> Result<(), String> {
    if crate::desktop_identity::local_object_scope()?.as_str() != scope {
        return Err("chatgpt_scope_changed".into());
    }
    Ok(())
}
fn lease(
    app: &AppHandle,
    scope: &str,
    account_id: &str,
    epoch: u64,
    owner_epoch: u64,
) -> Result<(), String> {
    guard(scope)?;
    if app.state::<ChatgptPlanState>().epoch.load(Ordering::SeqCst) != epoch
        || crate::desktop_identity::authorization_epoch()? != owner_epoch
        || accounts(app, scope)?.active_account.as_deref() != Some(account_id)
    {
        return Err("chatgpt_authorization_changed".into());
    }
    Ok(())
}
fn path(app: &AppHandle, scope: &str) -> Result<std::path::PathBuf, String> {
    Ok(crate::data_location::root(app)?
        .join("chatgpt-plan")
        .join(format!("{}.json", hash(scope))))
}
fn accounts(app: &AppHandle, scope: &str) -> Result<Accounts, String> {
    guard(scope)?;
    let path = path(app, scope)?;
    if !path.exists() {
        return Ok(Accounts::default());
    }
    let bytes = std::fs::read(path).map_err(|_| "chatgpt_accounts_unavailable")?;
    if bytes.len() > 256 * 1024 {
        return Err("chatgpt_accounts_corrupt".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "chatgpt_accounts_corrupt".into())
}
fn save_accounts(app: &AppHandle, scope: &str, accounts: &Accounts) -> Result<(), String> {
    guard(scope)?;
    crate::local_library::write_bytes_atomically(
        &path(app, scope)?,
        &serde_json::to_vec(accounts).map_err(|_| "chatgpt_accounts_corrupt")?,
    )
}
fn entry(scope: &str, id: &str) -> Result<Entry, String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("chatgpt_account_invalid".into());
    }
    Entry::new(
        "com.liteasy.desktop.chatgpt-plan",
        &format!("{}:{id}", hash(scope)),
    )
    .map_err(|_| "chatgpt_secure_store_unavailable".into())
}
fn load(scope: &str, id: &str) -> Result<Credentials, String> {
    guard(scope)?;
    let value = entry(scope, id)?
        .get_password()
        .map_err(|_| "chatgpt_sign_in_required")?;
    serde_json::from_str(&value).map_err(|_| "chatgpt_credentials_invalid".into())
}
fn save(scope: &str, credentials: &Credentials) -> Result<(), String> {
    guard(scope)?;
    entry(scope, &credentials.account.id)?
        .set_password(
            &serde_json::to_string(credentials).map_err(|_| "chatgpt_credentials_invalid")?,
        )
        .map_err(|_| "chatgpt_secure_store_write_failed".into())
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "chatgpt_http_unavailable".into())
}
async fn metadata(http: &reqwest::Client) -> Result<CoreProviderMetadata, String> {
    CoreProviderMetadata::discover_async(
        IssuerUrl::new(ISSUER.into()).map_err(|_| "chatgpt_issuer_invalid")?,
        http,
    )
    .await
    .map_err(|_| "chatgpt_discovery_failed".into())
}
fn host_id(app: &AppHandle) -> Result<String, String> {
    let path = crate::data_location::root(app)?
        .join("chatgpt-plan")
        .join("host-id");
    if let Ok(value) = std::fs::read_to_string(&path) {
        if value.starts_with("urn:uuid:") && value.len() == 45 {
            return Ok(value);
        }
    }
    let mut bytes = [0u8; 16];
    use ring::rand::SecureRandom;
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "chatgpt_entropy_unavailable")?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let value = format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    );
    crate::local_library::write_bytes_atomically(&path, value.as_bytes())?;
    Ok(value)
}
fn callback(
    listener: TcpListener,
    state: &str,
    cancelled: impl Fn() -> bool,
) -> Result<(String, Option<String>), String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "chatgpt_listener_failed")?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(300) {
        if cancelled() {
            return Err("chatgpt_authorization_cancelled".into());
        }
        match listener.accept() {
            Ok((mut socket, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .map_err(|_| "chatgpt_callback_failed")?;
                let mut bytes = Vec::new();
                use std::io::Read;
                BufReader::new(&socket)
                    .take(8193)
                    .read_until(b'\n', &mut bytes)
                    .map_err(|_| "chatgpt_callback_failed")?;
                if bytes.len() > 8192 {
                    continue;
                }
                let line = String::from_utf8(bytes).map_err(|_| "chatgpt_callback_invalid")?;
                let mut parts = line.split_whitespace();
                if parts.next() != Some("GET") {
                    continue;
                }
                let relative = parts.next().unwrap_or("");
                let url = Url::parse(&format!("http://127.0.0.1{relative}"))
                    .map_err(|_| "chatgpt_callback_invalid")?;
                if url.path() != "/auth/callback" {
                    continue;
                }
                let mut values = std::collections::HashMap::new();
                let mut duplicate = false;
                for (k, v) in url.query_pairs() {
                    if values.insert(k.into_owned(), v.into_owned()).is_some() {
                        duplicate = true;
                    }
                }
                if duplicate || values.get("state").map(String::as_str) != Some(state) {
                    continue;
                }
                let error = values.get("error").is_some();
                let body = if error {
                    "授权未完成，可以关闭此页面。"
                } else {
                    "授权回调已收到，请返回 Liteasy。"
                };
                let _=write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                if error {
                    return Err("chatgpt_authorization_denied".into());
                }
                let code = values
                    .remove("code")
                    .filter(|v| !v.is_empty() && v.len() < 4096)
                    .ok_or("chatgpt_code_missing")?;
                return Ok((code, values.remove("client_id")));
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(_) => return Err("chatgpt_callback_failed".into()),
        }
    }
    Err("chatgpt_authorization_timeout".into())
}
fn issued_client_id(callback: Option<String>, returning: Option<&str>) -> Result<String, String> {
    let value = match (returning, callback) {
        (Some(expected), Some(actual)) if expected != actual => {
            return Err("chatgpt_registration_mismatch".into())
        }
        (Some(expected), _) => expected.into(),
        (None, Some(actual)) => actual,
        _ => return Err("chatgpt_registration_incomplete".into()),
    };
    if value == "dynamic_agent_client" || value.is_empty() || value.len() > 512 {
        return Err("chatgpt_registration_incomplete".into());
    }
    Ok(value)
}
#[tauri::command]
pub fn chatgpt_plan_accounts(app: AppHandle, scope: String) -> Result<Value, String> {
    Ok(serde_json::to_value(accounts(&app, &scope)?).map_err(|_| "chatgpt_accounts_corrupt")?)
}
#[tauri::command]
pub fn chatgpt_plan_cancel(state: State<'_, ChatgptPlanState>) {
    state.epoch.fetch_add(1, Ordering::SeqCst);
}
#[tauri::command]
pub async fn chatgpt_plan_login(
    app: AppHandle,
    state: State<'_, ChatgptPlanState>,
    scope: String,
    account_id: Option<String>,
) -> Result<PlanAccount, String> {
    guard(&scope)?;
    let generation = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let owner_epoch = crate::desktop_identity::authorization_epoch()?;
    let returning = account_id
        .as_deref()
        .map(|id| load(&scope, id))
        .transpose()?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "chatgpt_loopback_unavailable")?;
    let redirect = format!(
        "http://127.0.0.1:{}/auth/callback",
        listener
            .local_addr()
            .map_err(|_| "chatgpt_loopback_unavailable")?
            .port()
    );
    let http = client()?;
    let metadata = metadata(&http).await?;
    let oidc = CoreClient::from_provider_metadata(
        metadata.clone(),
        ClientId::new(
            returning
                .as_ref()
                .map(|c| c.client_id.clone())
                .unwrap_or("dynamic_agent_client".into()),
        ),
        None,
    )
    .set_auth_uri(
        AuthUrl::new(format!("{ISSUER}/api/accounts/authorize"))
            .map_err(|_| "chatgpt_endpoint_invalid")?,
    )
    .set_redirect_uri(RedirectUrl::new(redirect.clone()).map_err(|_| "chatgpt_redirect_invalid")?);
    let (pkce, verifier) = PkceCodeChallenge::new_random_sha256();
    let mut request = oidc
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .set_pkce_challenge(pkce)
        .add_extra_param("resource", API)
        .add_extra_param("ext_agent_host_id", host_id(&app)?);
    for name in &SCOPES[1..] {
        request = request.add_scope(Scope::new((*name).into()));
    }
    if returning.is_none() {
        request = request.add_extra_param("agent_name_hint", "Liteasy");
    }
    let (url, csrf, nonce) = request.url();
    webbrowser::open(url.as_str()).map_err(|_| "chatgpt_browser_unavailable")?;
    let expected = csrf.secret().clone();
    // The callback worker only owns random correlation data, never stored credentials.
    let listener_generation = generation;
    let handle = app.clone();
    use tauri::Manager;
    let (code, callback_id) = tauri::async_runtime::spawn_blocking(move || {
        callback(listener, &expected, || {
            handle
                .state::<ChatgptPlanState>()
                .epoch
                .load(Ordering::SeqCst)
                != listener_generation
        })
    })
    .await
    .map_err(|_| "chatgpt_callback_failed")??;
    guard(&scope)?;
    if state.epoch.load(Ordering::SeqCst) != generation
        || crate::desktop_identity::authorization_epoch()? != owner_epoch
    {
        return Err("chatgpt_scope_changed".into());
    }
    let issued = issued_client_id(
        callback_id,
        returning.as_ref().map(|c| c.client_id.as_str()),
    )?;
    let oidc = CoreClient::from_provider_metadata(metadata, ClientId::new(issued.clone()), None)
        .set_token_uri(TokenUrl::new(TOKEN.into()).map_err(|_| "chatgpt_endpoint_invalid")?)
        .set_redirect_uri(RedirectUrl::new(redirect).map_err(|_| "chatgpt_redirect_invalid")?);
    let response = oidc
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(verifier)
        .add_extra_param("resource", API)
        .request_async(&http)
        .await
        .map_err(|_| "chatgpt_code_exchange_failed")?;
    let token = response.id_token().ok_or("chatgpt_id_token_missing")?;
    let claims = token
        .claims(&oidc.id_token_verifier(), &nonce)
        .map_err(|_| "chatgpt_id_token_invalid")?;
    if let Some(expected) = claims.access_token_hash() {
        let actual = AccessTokenHash::from_token(
            response.access_token(),
            token
                .signing_alg()
                .map_err(|_| "chatgpt_id_token_invalid")?,
            token
                .signing_key(&oidc.id_token_verifier())
                .map_err(|_| "chatgpt_id_token_invalid")?,
        )
        .map_err(|_| "chatgpt_access_token_hash_invalid")?;
        if &actual != expected {
            return Err("chatgpt_access_token_hash_mismatch".into());
        }
    }
    let subject = claims.subject().as_str().to_string();
    if returning.as_ref().is_some_and(|c| c.subject != subject) {
        return Err("chatgpt_identity_mismatch".into());
    }
    let scopes = response
        .scopes()
        .map(|v| v.iter().map(|s| s.as_str().to_string()).collect::<Vec<_>>())
        .unwrap_or_default();
    let account = PlanAccount {
        id: hash(&format!("{issued}:{subject}")),
        name: claims
            .name()
            .and_then(|v| v.get(None))
            .map(|s| s.to_string())
            .unwrap_or("ChatGPT".into()),
        email: claims
            .email()
            .map(|v| v.as_str().to_string())
            .unwrap_or_default(),
        client_id: issued.clone(),
        plan_usage_enabled: scopes.iter().any(|s| s == "chatgpt.tokens.use.direct"),
        inference_verified: false,
    };
    let credentials = Credentials {
        subject,
        client_id: issued,
        id_token: token.to_string(),
        access_token: response.access_token().secret().clone(),
        refresh_token: response
            .refresh_token()
            .ok_or("chatgpt_refresh_token_missing")?
            .secret()
            .clone(),
        expires_at: Utc::now().timestamp()
            + response
                .expires_in()
                .unwrap_or(Duration::from_secs(300))
                .as_secs() as i64,
        scopes,
        account: account.clone(),
    };
    guard(&scope)?;
    if state.epoch.load(Ordering::SeqCst) != generation
        || crate::desktop_identity::authorization_epoch()? != owner_epoch
    {
        return Err("chatgpt_authorization_cancelled".into());
    }
    save(&scope, &credentials)?;
    let mut list = accounts(&app, &scope)?;
    list.accounts.retain(|a| a.id != account.id);
    list.accounts.push(account.clone());
    list.active_account = Some(account.id.clone());
    save_accounts(&app, &scope, &list)?;
    Ok(account)
}
pub(crate) async fn access_token(app: &AppHandle, scope: &str, id: &str) -> Result<String, String> {
    let _refresh_guard = REFRESH_LOCK.lock().await;
    let epoch = app.state::<ChatgptPlanState>().epoch.load(Ordering::SeqCst);
    let owner_epoch = crate::desktop_identity::authorization_epoch()?;
    guard(scope)?;
    if accounts(app, scope)?.active_account.as_deref() != Some(id) {
        return Err("chatgpt_account_changed".into());
    }
    let mut credentials = load(scope, id)?;
    if !credentials
        .scopes
        .iter()
        .any(|s| s == "chatgpt.tokens.use.direct")
    {
        return Err("chatgpt_plan_usage_not_authorized".into());
    }
    if credentials.expires_at - Utc::now().timestamp() < 60 {
        let http = client()?;
        let oidc = CoreClient::from_provider_metadata(
            metadata(&http).await?,
            ClientId::new(credentials.client_id.clone()),
            None,
        )
        .set_token_uri(TokenUrl::new(TOKEN.into()).map_err(|_| "chatgpt_endpoint_invalid")?);
        let refresh = RefreshToken::new(credentials.refresh_token.clone());
        let response: CoreTokenResponse = oidc
            .exchange_refresh_token(&refresh)
            .add_extra_param("resource", API)
            .request_async(&http)
            .await
            .map_err(|_| "chatgpt_refresh_failed_sign_in_required")?;
        if let Some(token) = response.id_token() {
            let claims = token
                .claims(&oidc.id_token_verifier(), |_: Option<&Nonce>| Ok(()))
                .map_err(|_| "chatgpt_refresh_identity_invalid")?;
            if claims.subject().as_str() != credentials.subject {
                return Err("chatgpt_refresh_identity_mismatch".into());
            }
            credentials.id_token = token.to_string();
        }
        credentials.access_token = response.access_token().secret().clone();
        if let Some(token) = response.refresh_token() {
            credentials.refresh_token = token.secret().clone();
        }
        if let Some(scopes) = response.scopes() {
            credentials.scopes = scopes.iter().map(|s| s.as_str().to_string()).collect();
        }
        credentials.expires_at = Utc::now().timestamp()
            + response
                .expires_in()
                .unwrap_or(Duration::from_secs(300))
                .as_secs() as i64;
        lease(app, scope, id, epoch, owner_epoch)?;
        save(scope, &credentials)?;
    }
    if !credentials
        .scopes
        .iter()
        .any(|s| s == "chatgpt.tokens.use.direct")
    {
        return Err("chatgpt_plan_usage_not_authorized".into());
    }
    lease(app, scope, id, epoch, owner_epoch)?;
    Ok(credentials.access_token)
}
#[tauri::command]
pub fn chatgpt_plan_select(
    app: AppHandle,
    state: State<'_, ChatgptPlanState>,
    scope: String,
    account_id: String,
) -> Result<(), String> {
    let mut list = accounts(&app, &scope)?;
    if !list.accounts.iter().any(|a| a.id == account_id) {
        return Err("chatgpt_account_not_found".into());
    }
    state.epoch.fetch_add(1, Ordering::SeqCst);
    list.active_account = Some(account_id);
    save_accounts(&app, &scope, &list)
}
#[tauri::command]
pub fn chatgpt_plan_logout(
    app: AppHandle,
    state: State<'_, ChatgptPlanState>,
    scope: String,
    account_id: String,
) -> Result<(), String> {
    guard(&scope)?;
    state.epoch.fetch_add(1, Ordering::SeqCst);
    match entry(&scope, &account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => (),
        Err(_) => return Err("chatgpt_secure_store_delete_failed".into()),
    }
    let mut list = accounts(&app, &scope)?;
    list.accounts.retain(|a| a.id != account_id);
    if list.active_account.as_deref() == Some(&account_id) {
        list.active_account = None;
    }
    save_accounts(&app, &scope, &list)
}
#[tauri::command]
pub async fn chatgpt_plan_models(
    app: AppHandle,
    scope: String,
    account_id: String,
) -> Result<Value, String> {
    let epoch = app.state::<ChatgptPlanState>().epoch.load(Ordering::SeqCst);
    let owner_epoch = crate::desktop_identity::authorization_epoch()?;
    let token = access_token(&app, &scope, &account_id).await?;
    lease(&app, &scope, &account_id, epoch, owner_epoch)?;
    let mut response = client()?
        .get(format!("{API}/models"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "chatgpt_models_unavailable")?;
    if !response.status().is_success() {
        return Err(format!(
            "chatgpt_models_http_{}",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "chatgpt_models_interrupted")?
    {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > 1024 * 1024 {
            return Err("chatgpt_models_too_large".into());
        }
    }
    let body: Value = serde_json::from_slice(&bytes).map_err(|_| "chatgpt_models_invalid")?;
    lease(&app, &scope, &account_id, epoch, owner_epoch)?;
    let models = body["models"]
        .as_array()
        .ok_or("chatgpt_models_invalid")?
        .iter()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| {
            Some(json!({"slug":m["slug"].as_str()?,"displayName":m["display_name"].as_str()?}))
        })
        .collect::<Vec<_>>();
    Ok(json!(models))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanInference {
    pub scope: String,
    pub account_id: String,
    pub model: String,
    pub input: Vec<Value>,
    #[serde(default)]
    pub tools: Vec<Value>,
}
fn only_keys(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}
fn native_item(value: &Value) -> bool {
    let nonempty = |key: &str| value[key].as_str().is_some_and(|s| !s.is_empty());
    match value["type"].as_str() {
        Some("function_call") => {
            only_keys(value, &["type", "call_id", "name", "arguments"])
                && nonempty("call_id")
                && nonempty("name")
                && value["arguments"].is_string()
        }
        Some("function_call_output") => {
            only_keys(value, &["type", "call_id", "output"])
                && nonempty("call_id")
                && value["output"].is_string()
        }
        Some("reasoning") => {
            only_keys(value, &["type", "id", "encrypted_content", "summary"])
                && nonempty("id")
                && nonempty("encrypted_content")
                && value["summary"] == json!([])
        }
        None | Some("message") => {
            only_keys(value, &["type", "role", "content"])
                && matches!(
                    value["role"].as_str(),
                    Some("user" | "assistant" | "developer")
                )
                && (value["content"].is_string()
                    || value["content"].as_array().is_some_and(|parts| {
                        !parts.is_empty()
                            && parts.len() <= 64
                            && parts.iter().all(|part| match part["type"].as_str() {
                                Some("input_text" | "output_text") => {
                                    only_keys(part, &["type", "text"]) && part["text"].is_string()
                                }
                                Some("input_image") => {
                                    only_keys(part, &["type", "image_url"])
                                        && part["image_url"].as_str().is_some_and(|url| {
                                            url.starts_with("https://")
                                                || url.starts_with("data:image/")
                                        })
                                }
                                _ => false,
                            })
                    }))
        }
        _ => false,
    }
}
fn inference_body(request: &PlanInference) -> Result<Value, String> {
    if request.model.is_empty()
        || request.model.len() > 128
        || request.input.is_empty()
        || request.input.len() > 128
        || serde_json::to_vec(&request.input)
            .map_err(|_| "invalid_input")?
            .len()
            > 4 * 1024 * 1024
    {
        return Err("chatgpt_input_invalid".into());
    }
    for message in &request.input {
        if !native_item(message) {
            return Err("chatgpt_native_message_invalid".into());
        }
    }
    if request.tools.len() > 16
        || serde_json::to_vec(&request.tools)
            .map_err(|_| "invalid_tools")?
            .len()
            > 256 * 1024
    {
        return Err("chatgpt_tools_budget_exceeded".into());
    }
    for namespace in &request.tools {
        if !only_keys(namespace, &["type", "name", "description", "tools"])
            || namespace["type"] != "namespace"
            || namespace["name"]
                .as_str()
                .is_none_or(|s| s.is_empty() || s.len() > 128)
            || namespace["tools"].as_array().is_none_or(|tools| {
                tools.is_empty()
                    || tools.len() > 24
                    || tools.iter().any(|tool| {
                        !only_keys(
                            tool,
                            &["type", "name", "description", "parameters", "strict"],
                        ) || tool["type"] != "function"
                            || tool["name"]
                                .as_str()
                                .is_none_or(|s| s.is_empty() || s.len() > 128)
                            || !tool["parameters"].is_object()
                    })
            })
        {
            return Err("chatgpt_tool_not_supported".into());
        }
    }
    let mut body = json!({"model":request.model,"input":request.input,"store":false,"stream":true});
    if !request.tools.is_empty() {
        body["tools"] = json!(request.tools);
    }
    Ok(body)
}
#[tauri::command]
pub async fn chatgpt_plan_infer(
    app: AppHandle,
    state: State<'_, ChatgptPlanState>,
    request: PlanInference,
    chunks: Channel<String>,
) -> Result<Value, String> {
    let body = inference_body(&request)?;
    let generation = state.epoch.load(Ordering::SeqCst);
    let owner_epoch = crate::desktop_identity::authorization_epoch()?;
    let token = access_token(&app, &request.scope, &request.account_id).await?;
    lease(
        &app,
        &request.scope,
        &request.account_id,
        generation,
        owner_epoch,
    )?;
    if state.epoch.load(Ordering::SeqCst) != generation
        || crate::desktop_identity::authorization_epoch()? != owner_epoch
        || accounts(&app, &request.scope)?.active_account.as_deref()
            != Some(request.account_id.as_str())
    {
        return Err("chatgpt_inference_cancelled".into());
    }
    let mut response = client()?
        .post(format!("{API}/responses"))
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| "chatgpt_inference_unavailable")?;
    if !response.status().is_success() {
        return Err(format!(
            "chatgpt_inference_http_{}",
            response.status().as_u16()
        ));
    }
    let mut stream = crate::chatgpt_stream::ResponsesStream::default();
    loop {
        lease(
            &app,
            &request.scope,
            &request.account_id,
            generation,
            owner_epoch,
        )?;
        let chunk = match tokio::time::timeout(Duration::from_millis(250), response.chunk()).await {
            Err(_) => continue,
            Ok(result) => result.map_err(|_| "chatgpt_stream_interrupted")?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        stream.push(&chunk, |delta| {
            chunks
                .send(delta.into())
                .map_err(|_| "chatgpt_receiver_closed".into())
        })?;
    }
    let completed = stream.finish()?;
    let usage = completed["usage"].clone();
    lease(
        &app,
        &request.scope,
        &request.account_id,
        generation,
        owner_epoch,
    )?;
    let mut list = accounts(&app, &request.scope)?;
    if list.active_account.as_deref() != Some(request.account_id.as_str()) {
        return Err("chatgpt_account_changed".into());
    }
    if let Some(account) = list
        .accounts
        .iter_mut()
        .find(|a| a.id == request.account_id)
    {
        account.inference_verified = true;
    }
    save_accounts(&app, &request.scope, &list)?;
    Ok(
        json!({"status":"completed","usage":usage,"model":request.model,"provider":"chatgpt_plan","output":completed["output"]}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dynamic_registration_is_not_a_saved_client_or_cross_account_identity() {
        assert!(issued_client_id(Some("dynamic_agent_client".into()), None).is_err());
        assert!(issued_client_id(Some("another".into()), Some("issued")).is_err());
        assert_eq!(issued_client_id(None, Some("issued")).unwrap(), "issued");
    }
    #[test]
    fn plan_route_never_inherits_api_parameters_or_system_messages() {
        let r = PlanInference {
            scope: "local".into(),
            account_id: "account".into(),
            model: "chosen-slug".into(),
            input: vec![json!({"role":"user","content":"hello"})],
            tools: vec![],
        };
        let body = inference_body(&r).unwrap();
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert!(body.get("previous_response_id").is_none());
        assert!(body.get("temperature").is_none());
        let mut r = r;
        r.input = vec![json!({"role":"system","content":"not supported on this route"})];
        assert!(inference_body(&r).is_err());
    }
    #[test]
    fn native_tools_and_history_use_only_the_subscription_route_allowlist() {
        let mut r = PlanInference {
            scope: "local".into(),
            account_id: "account".into(),
            model: "selected".into(),
            input: vec![
                json!({"type":"function_call","call_id":"call","name":"read","arguments":"{}"}),
                json!({"type":"function_call_output","call_id":"call","output":"real source"}),
            ],
            tools: vec![
                json!({"type":"namespace","name":"research","tools":[{"type":"function","name":"read","parameters":{"type":"object"}}]}),
            ],
        };
        assert_eq!(
            inference_body(&r).unwrap()["input"][1]["output"],
            "real source"
        );
        r.tools = vec![json!({"type":"file_search"})];
        assert!(inference_body(&r).is_err());
        r.tools =
            vec![json!({"type":"namespace","name":"research","tools":[{"type":"tool_search"}]})];
        assert!(inference_body(&r).is_err());
        r.tools.clear();
        r.input =
            vec![json!({"role":"user","content":"hello","previous_response_id":"hidden-history"})];
        assert!(inference_body(&r).is_err());
        r.input = vec![
            json!({"role":"user","content":[{"type":"input_image","image_url":"file:///private"}]}),
        ];
        assert!(inference_body(&r).is_err());
    }
}
