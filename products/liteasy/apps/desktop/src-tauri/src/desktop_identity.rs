use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};
use keyring::Entry;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreProviderMetadata, CoreRevocableToken,
    CoreUserInfoClaims,
};
use openidconnect::reqwest;
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, CsrfToken, IssuerUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, RedirectUrl, RefreshToken, Scope, SubjectIdentifier, TokenResponse,
};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};
use url::Url;

const CREDENTIAL_SERVICE: &str = "com.liteasy.desktop.identity";
const CREDENTIAL_USERNAME: &str = "primary-refresh-token";
const EXPECTED_AUDIENCE: &str = "liteasy-desktop";
const CALLBACK_PATH: &str = "/oauth/callback";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_CALLBACK_REQUEST_LINE_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIdentityConfiguration {
    audience: String,
    client_id: String,
    issuer: String,
    revocation_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRefreshCredential {
    audience: String,
    client_id: String,
    email: String,
    issuer: String,
    name: String,
    refresh_token: String,
    subject: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOAuthSession {
    email: String,
    expires_at: String,
    name: String,
    session_id: String,
    user_id: String,
}

#[derive(Debug)]
struct CallbackResult {
    code: AuthorizationCode,
    state: CsrfToken,
}

fn validate_identity_configuration(
    configuration: &DesktopIdentityConfiguration,
) -> Result<IssuerUrl, String> {
    if configuration.audience != EXPECTED_AUDIENCE {
        return Err("oauth_audience_invalid".to_string());
    }
    if configuration.client_id.is_empty()
        || configuration.client_id.len() > 200
        || !configuration
            .client_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._~-".contains(character))
    {
        return Err("oauth_client_id_invalid".to_string());
    }
    let parsed = Url::parse(&configuration.issuer).map_err(|_| "oauth_issuer_invalid")?;
    if parsed.query().is_some() || parsed.fragment().is_some() || parsed.username() != "" {
        return Err("oauth_issuer_invalid".to_string());
    }
    let loopback = parsed
        .host_str()
        .and_then(|host| host.parse::<IpAddr>().ok())
        .is_some_and(|address| address.is_loopback());
    if parsed.scheme() != "https"
        && !(cfg!(debug_assertions) && parsed.scheme() == "http" && loopback)
    {
        return Err("oauth_issuer_https_required".to_string());
    }
    let revocation = Url::parse(&configuration.revocation_url)
        .map_err(|_| "oauth_revocation_url_invalid".to_string())?;
    if revocation.origin() != parsed.origin()
        || revocation.query().is_some()
        || revocation.fragment().is_some()
        || revocation.username() != ""
    {
        return Err("oauth_revocation_url_invalid".to_string());
    }
    IssuerUrl::new(configuration.issuer.clone()).map_err(|_| "oauth_issuer_invalid".to_string())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::ClientBuilder::new()
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .user_agent("LiteasyDesktop/0.1")
        .build()
        .map_err(|_| "oauth_http_client_unavailable".to_string())
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USERNAME)
        .map_err(|_| "oauth_secure_storage_unavailable".to_string())
}

fn save_refresh_credential(credential: &StoredRefreshCredential) -> Result<(), String> {
    if credential.refresh_token.is_empty() || credential.refresh_token.len() > 8 * 1024 {
        return Err("oauth_refresh_token_invalid".to_string());
    }
    let serialized = serde_json::to_string(credential)
        .map_err(|_| "oauth_secure_storage_invalid".to_string())?;
    credential_entry()?
        .set_password(&serialized)
        .map_err(|_| "oauth_secure_storage_write_failed".to_string())
}

fn load_refresh_credential() -> Result<StoredRefreshCredential, String> {
    let serialized = credential_entry()?
        .get_password()
        .map_err(|error| match error {
            keyring::Error::NoEntry => "oauth_session_not_found".to_string(),
            _ => "oauth_secure_storage_read_failed".to_string(),
        })?;
    let credential: StoredRefreshCredential = serde_json::from_str(&serialized)
        .map_err(|_| "oauth_secure_storage_invalid".to_string())?;
    if credential.refresh_token.is_empty() || credential.subject.is_empty() {
        return Err("oauth_secure_storage_invalid".to_string());
    }
    Ok(credential)
}

fn clear_refresh_credential() -> Result<(), String> {
    credential_entry()?
        .delete_credential()
        .or_else(|error| match error {
            keyring::Error::NoEntry => Ok(()),
            _ => Err(error),
        })
        .map_err(|_| "oauth_secure_storage_delete_failed".to_string())
}

fn parse_callback_request_line(
    request_line: &str,
    callback_origin: &str,
) -> Result<CallbackResult, String> {
    if request_line.len() > MAX_CALLBACK_REQUEST_LINE_BYTES {
        return Err("oauth_callback_too_large".to_string());
    }
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err("oauth_callback_method_invalid".to_string());
    }
    let target = parts
        .next()
        .ok_or_else(|| "oauth_callback_invalid".to_string())?;
    if !target.starts_with('/') || target.starts_with("//") {
        return Err("oauth_callback_invalid".to_string());
    }
    if parts.next().is_none() || parts.next().is_some() {
        return Err("oauth_callback_invalid".to_string());
    }
    let origin = Url::parse(callback_origin).map_err(|_| "oauth_callback_invalid".to_string())?;
    let callback = origin
        .join(target)
        .map_err(|_| "oauth_callback_invalid".to_string())?;
    if callback.origin() != origin.origin() || callback.path() != CALLBACK_PATH {
        return Err("oauth_callback_path_invalid".to_string());
    }
    let mut code = None;
    let mut state = None;
    let mut provider_error = None;
    for (key, value) in callback.query_pairs() {
        match key.as_ref() {
            "code" if code.is_none() => code = Some(value.into_owned()),
            "code" => return Err("oauth_callback_invalid".to_string()),
            "state" if state.is_none() => state = Some(value.into_owned()),
            "state" => return Err("oauth_callback_invalid".to_string()),
            "error" if provider_error.is_none() => provider_error = Some(value.into_owned()),
            "error" => return Err("oauth_callback_invalid".to_string()),
            _ => {}
        };
    }
    if provider_error.is_some() {
        return Err("oauth_authorization_denied".to_string());
    }
    Ok(CallbackResult {
        code: AuthorizationCode::new(code.ok_or_else(|| "oauth_code_missing".to_string())?),
        state: CsrfToken::new(state.ok_or_else(|| "oauth_state_missing".to_string())?),
    })
}

fn write_callback_response(stream: &mut TcpStream, success: bool) {
    let body = if success {
        "Liteasy sign-in completed. You can close this browser tab."
    } else {
        "Liteasy could not complete sign-in. Return to the app and try again."
    };
    let status = if success { "200 OK" } else { "400 Bad Request" };
    let response = format!(
        "HTTP/1.1 {status}\r\ncontent-length: {}\r\ncontent-type: text/plain; charset=utf-8\r\ncache-control: no-store\r\nconnection: close\r\nx-content-type-options: nosniff\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn receive_callback(
    listener: TcpListener,
    callback_origin: String,
    expected_state: CsrfToken,
) -> Result<CallbackResult, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "oauth_callback_listener_failed".to_string())?;
    let deadline = Instant::now() + CALLBACK_TIMEOUT;
    loop {
        let (mut stream, peer) = match listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("oauth_callback_timeout".to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            Err(_) => return Err("oauth_callback_failed".to_string()),
        };
        stream
            .set_nonblocking(false)
            .map_err(|_| "oauth_callback_listener_failed".to_string())?;
        if !peer.ip().is_loopback() {
            write_callback_response(&mut stream, false);
            continue;
        }
        stream
            .set_read_timeout(Some(deadline.saturating_duration_since(Instant::now())))
            .map_err(|_| "oauth_callback_listener_failed".to_string())?;
        let mut request_line = String::new();
        let parsed = {
            let mut reader = BufReader::new(&stream);
            reader
                .read_line(&mut request_line)
                .map_err(|_| "oauth_callback_invalid".to_string())?;
            parse_callback_request_line(&request_line, &callback_origin)
        };
        match parsed {
            Ok(callback) if callback.state == expected_state => {
                write_callback_response(&mut stream, true);
                return Ok(callback);
            }
            Err(code) if code == "oauth_authorization_denied" => {
                write_callback_response(&mut stream, false);
                return Err(code);
            }
            _ => write_callback_response(&mut stream, false),
        }
    }
}

fn expires_at(expires_in: Option<Duration>) -> Result<String, String> {
    let seconds = expires_in
        .ok_or_else(|| "oauth_token_expiration_missing".to_string())?
        .as_secs();
    if seconds == 0 || seconds > 24 * 60 * 60 {
        return Err("oauth_token_expiration_invalid".to_string());
    }
    Ok((Utc::now() + ChronoDuration::seconds(seconds as i64))
        .to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn session_from_token(
    access_token: String,
    expires_in: Option<Duration>,
    email: String,
    name: String,
    subject: String,
) -> Result<DesktopOAuthSession, String> {
    if access_token.is_empty() || access_token.len() > 16 * 1024 {
        return Err("oauth_access_token_invalid".to_string());
    }
    Ok(DesktopOAuthSession {
        email,
        expires_at: expires_at(expires_in)?,
        name,
        session_id: access_token,
        user_id: subject,
    })
}

#[tauri::command]
pub async fn begin_desktop_oauth_login(
    configuration: DesktopIdentityConfiguration,
) -> Result<DesktopOAuthSession, String> {
    let issuer = validate_identity_configuration(&configuration)?;
    let http_client = http_client()?;
    let provider_metadata = CoreProviderMetadata::discover_async(issuer, &http_client)
        .await
        .map_err(|_| "oauth_discovery_failed".to_string())?;
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .map_err(|_| "oauth_callback_listener_failed".to_string())?;
    let callback_origin = format!(
        "http://127.0.0.1:{}",
        listener
            .local_addr()
            .map_err(|_| "oauth_callback_listener_failed".to_string())?
            .port()
    );
    let redirect_uri = format!("{callback_origin}{CALLBACK_PATH}");
    let client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(configuration.client_id.clone()),
        None,
    )
    .set_revocation_url(
        openidconnect::RevocationUrl::new(configuration.revocation_url.clone())
            .map_err(|_| "oauth_revocation_url_invalid".to_string())?,
    )
    .set_redirect_uri(
        RedirectUrl::new(redirect_uri).map_err(|_| "oauth_callback_url_invalid".to_string())?,
    );
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (authorization_url, expected_state, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("email".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .add_scope(Scope::new("offline_access".to_string()))
        .add_extra_param("audience", configuration.audience.clone())
        .set_pkce_challenge(pkce_challenge)
        .url();
    webbrowser::open(authorization_url.as_str())
        .map_err(|_| "oauth_system_browser_failed".to_string())?;
    let callback = tauri::async_runtime::spawn_blocking(move || {
        receive_callback(listener, callback_origin, expected_state)
    })
    .await
    .map_err(|_| "oauth_callback_failed".to_string())??;
    let token_response = client
        .exchange_code(callback.code)
        .map_err(|_| "oauth_token_endpoint_missing".to_string())?
        .set_pkce_verifier(pkce_verifier)
        .request_async(&http_client)
        .await
        .map_err(|_| "oauth_code_exchange_failed".to_string())?;
    let id_token = token_response
        .id_token()
        .ok_or_else(|| "oauth_id_token_missing".to_string())?;
    let verifier = client.id_token_verifier();
    let claims = id_token
        .claims(&verifier, &nonce)
        .map_err(|_| "oauth_id_token_invalid".to_string())?;
    if let Some(expected_hash) = claims.access_token_hash() {
        let actual_hash = AccessTokenHash::from_token(
            token_response.access_token(),
            id_token
                .signing_alg()
                .map_err(|_| "oauth_id_token_invalid".to_string())?,
            id_token
                .signing_key(&verifier)
                .map_err(|_| "oauth_id_token_invalid".to_string())?,
        )
        .map_err(|_| "oauth_access_token_hash_invalid".to_string())?;
        if &actual_hash != expected_hash {
            return Err("oauth_access_token_hash_mismatch".to_string());
        }
    }
    let subject = claims.subject().as_str().to_string();
    let user_info: CoreUserInfoClaims = client
        .user_info(
            token_response.access_token().to_owned(),
            Some(claims.subject().clone()),
        )
        .map_err(|_| "oauth_userinfo_endpoint_missing".to_string())?
        .request_async(&http_client)
        .await
        .map_err(|_| "oauth_userinfo_failed".to_string())?;
    let email = user_info
        .email()
        .map(|value| value.as_str().to_string())
        .unwrap_or_default();
    let name = user_info
        .name()
        .and_then(|localized| localized.get(None))
        .map(|value| value.as_str().to_string())
        .or_else(|| {
            user_info
                .preferred_username()
                .map(|value| value.as_str().to_string())
        })
        .unwrap_or_else(|| subject.clone());
    let refresh_token = token_response
        .refresh_token()
        .ok_or_else(|| "oauth_refresh_token_missing".to_string())?
        .secret()
        .to_string();
    save_refresh_credential(&StoredRefreshCredential {
        audience: configuration.audience,
        client_id: configuration.client_id,
        email: email.clone(),
        issuer: configuration.issuer,
        name: name.clone(),
        refresh_token,
        subject: subject.clone(),
    })?;
    session_from_token(
        token_response.access_token().secret().to_string(),
        token_response.expires_in(),
        email,
        name,
        subject,
    )
}

#[tauri::command]
pub async fn restore_desktop_oauth_session(
    configuration: DesktopIdentityConfiguration,
) -> Result<DesktopOAuthSession, String> {
    let issuer = validate_identity_configuration(&configuration)?;
    let mut stored = load_refresh_credential()?;
    if stored.issuer != configuration.issuer
        || stored.client_id != configuration.client_id
        || stored.audience != configuration.audience
    {
        return Err("oauth_session_configuration_mismatch".to_string());
    }
    let http_client = http_client()?;
    let provider_metadata = CoreProviderMetadata::discover_async(issuer, &http_client)
        .await
        .map_err(|_| "oauth_discovery_failed".to_string())?;
    let client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(configuration.client_id),
        None,
    )
    .set_revocation_url(
        openidconnect::RevocationUrl::new(configuration.revocation_url.clone())
            .map_err(|_| "oauth_revocation_url_invalid".to_string())?,
    );
    let refresh_token = RefreshToken::new(stored.refresh_token.clone());
    let token_response = client
        .exchange_refresh_token(&refresh_token)
        .map_err(|_| "oauth_token_endpoint_missing".to_string())?
        .request_async(&http_client)
        .await
        .map_err(|_| "oauth_session_refresh_failed".to_string())?;
    let _: CoreUserInfoClaims = client
        .user_info(
            token_response.access_token().to_owned(),
            Some(SubjectIdentifier::new(stored.subject.clone())),
        )
        .map_err(|_| "oauth_userinfo_endpoint_missing".to_string())?
        .request_async(&http_client)
        .await
        .map_err(|_| "oauth_userinfo_failed".to_string())?;
    if let Some(rotated) = token_response.refresh_token() {
        stored.refresh_token = rotated.secret().to_string();
        save_refresh_credential(&stored)?;
    }
    session_from_token(
        token_response.access_token().secret().to_string(),
        token_response.expires_in(),
        stored.email,
        stored.name,
        stored.subject,
    )
}

#[tauri::command]
pub async fn revoke_desktop_oauth_session(
    configuration: DesktopIdentityConfiguration,
) -> Result<(), String> {
    let issuer = validate_identity_configuration(&configuration)?;
    let stored = match load_refresh_credential() {
        Ok(value) => value,
        Err(code) if code == "oauth_session_not_found" => return Ok(()),
        Err(code) => return Err(code),
    };
    clear_refresh_credential()?;
    if stored.issuer != configuration.issuer
        || stored.client_id != configuration.client_id
        || stored.audience != configuration.audience
    {
        return Ok(());
    }
    let http_client = http_client()?;
    let provider_metadata = CoreProviderMetadata::discover_async(issuer, &http_client)
        .await
        .map_err(|_| "oauth_discovery_failed".to_string())?;
    let client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(configuration.client_id),
        None,
    )
    .set_revocation_url(
        openidconnect::RevocationUrl::new(configuration.revocation_url)
            .map_err(|_| "oauth_revocation_url_invalid".to_string())?,
    );
    let token: CoreRevocableToken = RefreshToken::new(stored.refresh_token).into();
    client
        .revoke_token(token)
        .map_err(|_| "oauth_revocation_endpoint_missing".to_string())?
        .request_async(&http_client)
        .await
        .map_err(|_| "oauth_revocation_failed".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(issuer: &str) -> DesktopIdentityConfiguration {
        DesktopIdentityConfiguration {
            audience: EXPECTED_AUDIENCE.to_string(),
            client_id: "liteasy-desktop-public".to_string(),
            issuer: issuer.to_string(),
            revocation_url: "https://identity.example.com/oauth2/revoke".to_string(),
        }
    }

    #[test]
    fn release_identity_configuration_requires_the_desktop_audience_and_safe_client_id() {
        let mut input = config("https://identity.example.com");
        assert!(validate_identity_configuration(&input).is_ok());
        input.audience = "intuecho-web".to_string();
        assert_eq!(
            validate_identity_configuration(&input).unwrap_err(),
            "oauth_audience_invalid"
        );
        input.audience = EXPECTED_AUDIENCE.to_string();
        input.client_id = "bad client".to_string();
        assert_eq!(
            validate_identity_configuration(&input).unwrap_err(),
            "oauth_client_id_invalid"
        );
    }

    #[test]
    fn callback_parser_accepts_only_the_expected_loopback_path_and_shape() {
        let parsed = parse_callback_request_line(
            "GET /oauth/callback?code=abc&state=state-1 HTTP/1.1\r\n",
            "http://127.0.0.1:41000",
        )
        .unwrap();
        assert_eq!(parsed.code.secret(), "abc");
        assert_eq!(parsed.state.secret(), "state-1");
        assert_eq!(
            parse_callback_request_line(
                "GET /other?code=abc&state=state-1 HTTP/1.1\r\n",
                "http://127.0.0.1:41000",
            )
            .unwrap_err(),
            "oauth_callback_path_invalid"
        );
        assert_eq!(
            parse_callback_request_line(
                "GET /oauth/callback?error=access_denied&state=state-1 HTTP/1.1\r\n",
                "http://127.0.0.1:41000",
            )
            .unwrap_err(),
            "oauth_authorization_denied"
        );
        assert_eq!(
            parse_callback_request_line(
                "GET //evil.example/oauth/callback?code=abc&state=state-1 HTTP/1.1\r\n",
                "http://127.0.0.1:41000",
            )
            .unwrap_err(),
            "oauth_callback_invalid"
        );
        assert_eq!(
            parse_callback_request_line(
                "GET /oauth/callback?code=abc&code=other&state=state-1 HTTP/1.1\r\n",
                "http://127.0.0.1:41000",
            )
            .unwrap_err(),
            "oauth_callback_invalid"
        );
    }

    #[test]
    fn token_expiration_is_required_and_bounded() {
        assert_eq!(
            expires_at(None).unwrap_err(),
            "oauth_token_expiration_missing"
        );
        assert_eq!(
            expires_at(Some(Duration::from_secs(24 * 60 * 60 + 1))).unwrap_err(),
            "oauth_token_expiration_invalid"
        );
        assert!(expires_at(Some(Duration::from_secs(900)))
            .unwrap()
            .ends_with('Z'));
    }
}
