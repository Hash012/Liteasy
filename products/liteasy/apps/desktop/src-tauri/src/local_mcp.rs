//! Local stdio MCP bridge. The WebView owns the same asset repositories as the UI.
//! Only an authenticated loopback connection can reach it; no HTTP/public server.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_FRAME: u64 = 16 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(110);
const EVENT: &str = "liteasy-local-mcp-request";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    address: SocketAddr,
    token: String,
    scope_id: String,
    generation: String,
}

#[derive(Default)]
struct Runtime {
    address: Option<SocketAddr>,
    connection: Option<Connection>,
    writable: bool,
    pending: HashMap<String, mpsc::Sender<Value>>,
}

#[derive(Default)]
pub struct LocalMcpState(Mutex<Runtime>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMcpInfo {
    enabled: bool,
    writable: bool,
    scope_id: Option<String>,
    generation: Option<String>,
    executable: String,
    connection_file: String,
}

fn random_id() -> String {
    openidconnect::Nonce::new_random().secret().clone()
}

fn connection_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("local-mcp")
        .join("connection.json"))
}

fn info(app: &AppHandle, runtime: &Runtime) -> Result<LocalMcpInfo, String> {
    Ok(LocalMcpInfo {
        enabled: runtime.connection.is_some(),
        writable: runtime.writable,
        scope_id: runtime.connection.as_ref().map(|c| c.scope_id.clone()),
        generation: runtime.connection.as_ref().map(|c| c.generation.clone()),
        executable: std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into(),
        connection_file: connection_file(app)?.to_string_lossy().into(),
    })
}

#[tauri::command]
pub fn local_mcp_info(
    app: AppHandle,
    state: State<'_, LocalMcpState>,
) -> Result<LocalMcpInfo, String> {
    let runtime = state.0.lock().map_err(|e| e.to_string())?;
    info(&app, &runtime)
}

fn save_connection(path: &Path, connection: &Connection) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing MCP configuration directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let temporary = path.with_extension("tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, connection).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(temporary, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_mcp_configure(
    app: AppHandle,
    state: State<'_, LocalMcpState>,
    enabled: bool,
    writable: bool,
    scope_id: String,
) -> Result<LocalMcpInfo, String> {
    if scope_id.is_empty() || scope_id.len() > 512 {
        return Err("Invalid workspace scope".into());
    }
    let mut runtime = state.0.lock().map_err(|e| e.to_string())?;
    // Any policy/account change revokes existing clients and pending requests.
    runtime.connection = None;
    runtime.writable = false;
    for (_, sender) in runtime.pending.drain() {
        let _ = sender.send(json!({"error": "MCP access changed. Reconnect from Codex."}));
    }
    let path = connection_file(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    if enabled {
        if runtime.address.is_none() {
            let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
            runtime.address = Some(listener.local_addr().map_err(|e| e.to_string())?);
            let host = app.clone();
            std::thread::spawn(move || {
                // One bounded request at a time; clients open a fresh socket per frame.
                // The accept loop cannot accumulate threads or queued WebView requests.
                for stream in listener.incoming().flatten() {
                    let _ = serve_connection(stream, |request| forward(&host, request));
                }
            });
        }
        let connection = Connection {
            address: runtime.address.ok_or("MCP listener unavailable")?,
            token: random_id(),
            generation: random_id(),
            scope_id,
        };
        save_connection(&path, &connection)?;
        runtime.connection = Some(connection);
        runtime.writable = writable;
    }
    info(&app, &runtime)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest {
    token: String,
    generation: String,
    scope_id: String,
    line: String,
}

fn read_frame(reader: &mut impl BufRead) -> Result<String, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_FRAME + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FRAME {
        return Err("MCP message exceeds 16 MiB".into());
    }
    if bytes.last() != Some(&b'\n') {
        return Err("Incomplete MCP message".into());
    }
    String::from_utf8(bytes).map_err(|_| "MCP requires UTF-8".into())
}

fn serve_connection(
    mut stream: TcpStream,
    forward: impl FnOnce(BridgeRequest) -> Result<Value, String>,
) -> Result<(), String> {
    // Unauthenticated peers get a short deadline, so an idle socket cannot block MCP.
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    let result = read_frame(&mut BufReader::new(&stream))
        .and_then(|line| {
            serde_json::from_str(&line).map_err(|_| "Invalid MCP bridge request".to_string())
        })
        .and_then(forward);
    let response = match result {
        Ok(value) => value,
        Err(error) => json!({"error": error}),
    };
    serde_json::to_writer(&mut stream, &response).map_err(|e| e.to_string())?;
    stream.write_all(b"\n").map_err(|e| e.to_string())
}

fn authorized(connection: &Connection, request: &BridgeRequest) -> bool {
    connection.token == request.token
        && connection.generation == request.generation
        && connection.scope_id == request.scope_id
}

fn forward(app: &AppHandle, request: BridgeRequest) -> Result<Value, String> {
    let id = random_id();
    let (sender, receiver) = mpsc::channel();
    let writable;
    {
        let state = app.state::<LocalMcpState>();
        let mut runtime = state.0.lock().map_err(|e| e.to_string())?;
        if !runtime
            .connection
            .as_ref()
            .is_some_and(|c| authorized(c, &request))
        {
            return Err("MCP is disabled or this connection expired. Reconnect from Codex.".into());
        }
        writable = runtime.writable;
        runtime.pending.insert(id.clone(), sender);
    }
    let result = app.emit(EVENT, json!({ "requestId": id, "scopeId": request.scope_id,
        "generation": request.generation, "writable": writable, "line": request.line }))
        .map_err(|e| e.to_string()).and_then(|_| receiver.recv_timeout(TIMEOUT).map_err(|_| "Liteasy did not respond. Keep the app open and retry reads; inspect the saved revision before retrying writes.".into()));
    if let Ok(mut runtime) = app.state::<LocalMcpState>().0.lock() {
        runtime.pending.remove(&id);
    }
    if result.is_err() {
        let _ = app.emit("liteasy-local-mcp-cancel", json!({"requestId":id}));
    }
    result
}

#[tauri::command]
pub fn local_mcp_reply(
    state: State<'_, LocalMcpState>,
    request_id: String,
    response: Value,
) -> Result<(), String> {
    let sender = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .pending
        .remove(&request_id)
        .ok_or("MCP request expired")?;
    sender.send(response).map_err(|e| e.to_string())
}

fn send(connection: &Connection, line: &str) -> Result<Value, String> {
    if !connection.address.ip().is_loopback() {
        return Err("MCP connection must use loopback".into());
    }
    let mut stream = TcpStream::connect_timeout(&connection.address, Duration::from_secs(3))
        .map_err(|_| {
            "Open Liteasy and enable Local MCP in Settings → AI & Assistant.".to_string()
        })?;
    stream
        .set_read_timeout(Some(TIMEOUT + Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    let request = json!({"token": connection.token, "generation": connection.generation, "scopeId": connection.scope_id, "line": line});
    serde_json::to_writer(&mut stream, &request).map_err(|e| e.to_string())?;
    stream.write_all(b"\n").map_err(|e| e.to_string())?;
    serde_json::from_str(&read_frame(&mut BufReader::new(stream))?).map_err(|e| e.to_string())
}

/// Runs before Tauri/single-instance initialization, including on Windows GUI builds.
pub fn run_stdio(path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path)
        .map_err(|_| "Enable Local MCP in Liteasy Settings before connecting Codex.".to_string())?;
    let connection: Connection = serde_json::from_reader(file.take(8192)).map_err(|_| {
        "MCP connection is unavailable; enable it again in Liteasy Settings.".to_string()
    })?;
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let stdout = std::io::stdout();
    let mut writer = stdout.lock();
    while !reader.fill_buf().map_err(|e| e.to_string())?.is_empty() {
        let line = read_frame(&mut reader)?;
        let response = send(&connection, &line)?;
        if let Some(error) = response.get("error").and_then(Value::as_str) {
            return Err(error.into());
        }
        if let Some(output) = response.get("line").and_then(Value::as_str) {
            writer
                .write_all(output.as_bytes())
                .and_then(|_| writer.write_all(b"\n"))
                .and_then(|_| writer.flush())
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_are_bounded_and_require_newline_and_utf8() {
        assert_eq!(read_frame(&mut &b"{}\nrest"[..]).unwrap(), "{}\n");
        assert!(read_frame(&mut &b"{}"[..]).is_err());
        assert!(read_frame(&mut &b"\xff\n"[..]).is_err());
        assert!(read_frame(&mut vec![b'a'; MAX_FRAME as usize + 1].as_slice()).is_err());
    }
    #[test]
    fn connection_is_bound_to_token_scope_and_generation() {
        let c = Connection {
            address: "127.0.0.1:12345".parse().unwrap(),
            token: random_id(),
            generation: random_id(),
            scope_id: "user:a".into(),
        };
        let mut r = BridgeRequest {
            token: c.token.clone(),
            generation: c.generation.clone(),
            scope_id: c.scope_id.clone(),
            line: "{}".into(),
        };
        assert!(authorized(&c, &r));
        r.scope_id = "user:b".into();
        assert!(!authorized(&c, &r));
        r.scope_id = c.scope_id.clone();
        r.token = random_id();
        assert!(!authorized(&c, &r));
        r.token = c.token.clone();
        r.generation = random_id();
        assert!(!authorized(&c, &r));
    }
    #[test]
    fn real_loopback_transport_preserves_json_and_notifications() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let c = Connection {
            address: listener.local_addr().unwrap(),
            token: random_id(),
            generation: random_id(),
            scope_id: "guest".into(),
        };
        let host = c.clone();
        let thread = std::thread::spawn(move || {
            for (index, stream) in listener.incoming().take(2).enumerate() {
                serve_connection(stream.unwrap(), |request| {
                    assert!(authorized(&host, &request));
                    Ok(json!({"line": if index == 0 { Some(request.line) } else { None }}))
                })
                .unwrap();
            }
        });
        assert_eq!(
            send(&c, "{\"title\":\"笔记\"}").unwrap()["line"],
            "{\"title\":\"笔记\"}"
        );
        assert!(send(&c, "{}").unwrap()["line"].is_null());
        thread.join().unwrap();
    }
}
