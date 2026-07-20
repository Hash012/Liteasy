use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const HOST_EVENT: &str = "liteasy-agent-host-request";
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct AgentHostState {
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalHostRequest {
    kind: String,
    payload: Value,
    request_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontendHostRequest {
    kind: String,
    payload: Value,
    request_id: String,
}

#[tauri::command]
pub fn agent_host_reply(
    request_id: String,
    response: Value,
    state: State<'_, AgentHostState>,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "Agent host pending map is poisoned".to_string())?
        .remove(&request_id)
        .ok_or_else(|| format!("Unknown Agent host request: {request_id}"))?;
    sender
        .send(response)
        .map_err(|_| "Agent host requester disconnected".to_string())
}

fn configured_socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("LITEASY_AGENT_SOCKET") {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library/Application Support/com.liteasy.desktop/agent.sock");
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            return PathBuf::from(data_home).join("com.liteasy.desktop/agent.sock");
        }
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(".local/share/com.liteasy.desktop/agent.sock");
        }
    }

    std::env::temp_dir().join("liteasy-agent.sock")
}

fn request_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("external-{}-{nanos}", std::process::id())
}

#[cfg(unix)]
fn handle_connection(
    app: AppHandle,
    stream: std::os::unix::net::UnixStream,
) -> Result<(), String> {
    let reader_stream = stream
        .try_clone()
        .map_err(|error| format!("Could not clone Agent socket: {error}"))?;
    let mut reader = BufReader::new(reader_stream);
    let mut writer = BufWriter::new(stream);
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| format!("Could not read Agent socket: {error}"))?;
        if read == 0 {
            return Ok(());
        }

        let request: ExternalHostRequest = serde_json::from_str(line.trim_end())
            .map_err(|error| format!("Invalid Agent host request: {error}"))?;
        let (sender, receiver) = mpsc::channel();
        {
            let state = app.state::<AgentHostState>();
            let mut pending = state
                .pending
                .lock()
                .map_err(|_| "Agent host pending map is poisoned".to_string())?;
            if pending.contains_key(&request.request_id) {
                return Err(format!(
                    "Duplicate Agent host request id: {}",
                    request.request_id
                ));
            }
            pending.insert(request.request_id.clone(), sender);
        }

        let event = FrontendHostRequest {
            kind: request.kind,
            payload: request.payload,
            request_id: request.request_id.clone(),
        };
        if let Err(error) = app.emit(HOST_EVENT, event) {
            app.state::<AgentHostState>()
                .pending
                .lock()
                .map_err(|_| "Agent host pending map is poisoned".to_string())?
                .remove(&request.request_id);
            return Err(format!("Could not emit Agent host request: {error}"));
        }

        let response = receiver.recv_timeout(RESPONSE_TIMEOUT).map_err(|error| {
            app.state::<AgentHostState>()
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request.request_id));
            format!("Agent host response timeout: {error}")
        })?;
        serde_json::to_writer(&mut writer, &response)
            .map_err(|error| format!("Could not encode Agent host response: {error}"))?;
        writer
            .write_all(b"\n")
            .and_then(|_| writer.flush())
            .map_err(|error| format!("Could not write Agent host response: {error}"))?;
    }
}

#[cfg(unix)]
pub fn start(app: AppHandle) -> Result<(), String> {
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};

    let socket_path = configured_socket_path();
    let parent = socket_path
        .parent()
        .ok_or_else(|| "Agent socket path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create Agent socket directory: {error}"))?;

    if socket_path.exists() {
        if UnixStream::connect(&socket_path).is_ok() {
            return Err(format!(
                "Another Liteasy Agent host is already running at {}",
                socket_path.display()
            ));
        }
        let metadata = std::fs::symlink_metadata(&socket_path)
            .map_err(|error| format!("Could not inspect stale Agent socket: {error}"))?;
        if !metadata.file_type().is_socket() {
            return Err(format!(
                "Refusing to replace non-socket Agent host path: {}",
                socket_path.display()
            ));
        }
        std::fs::remove_file(&socket_path)
            .map_err(|error| format!("Could not remove stale Agent socket: {error}"))?;
    }

    let listener = UnixListener::bind(&socket_path)
        .map_err(|error| format!("Could not bind Agent socket: {error}"))?;
    std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Could not secure Agent socket: {error}"))?;

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let connection_app = app.clone();
                    std::thread::spawn(move || {
                        if let Err(error) = handle_connection(connection_app, stream) {
                            eprintln!("Liteasy Agent host connection failed: {error}");
                        }
                    });
                }
                Err(error) => eprintln!("Liteasy Agent host accept failed: {error}"),
            }
        }
    });
    Ok(())
}

#[cfg(not(unix))]
pub fn start(_app: AppHandle) -> Result<(), String> {
    eprintln!("Liteasy external Agent host is not yet available on this platform.");
    Ok(())
}

#[cfg(unix)]
fn send_external_request(kind: &str, payload: Value) -> Result<Value, String> {
    use std::os::unix::net::UnixStream;

    let stream = UnixStream::connect(configured_socket_path())
        .map_err(|error| format!("Could not connect to the running Liteasy Agent host: {error}"))?;
    let mut writer = BufWriter::new(
        stream
            .try_clone()
            .map_err(|error| format!("Could not clone Agent socket: {error}"))?,
    );
    serde_json::to_writer(
        &mut writer,
        &json!({
            "kind": kind,
            "payload": payload,
            "requestId": request_id()
        }),
    )
    .map_err(|error| format!("Could not encode Agent request: {error}"))?;
    writer
        .write_all(b"\n")
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Could not send Agent request: {error}"))?;

    let mut response = String::new();
    BufReader::new(stream)
        .read_line(&mut response)
        .map_err(|error| format!("Could not read Agent response: {error}"))?;
    serde_json::from_str(response.trim_end())
        .map_err(|error| format!("Invalid Agent host response: {error}"))
}

#[cfg(not(unix))]
fn send_external_request(_kind: &str, _payload: Value) -> Result<Value, String> {
    Err("Liteasy external Agent host is not yet available on this platform".to_string())
}

fn print_host_error(response: &Value) -> Option<i32> {
    if response.get("ok").and_then(Value::as_bool) == Some(false) {
        eprintln!(
            "{}",
            response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Liteasy Agent host request failed")
        );
        return Some(1);
    }
    None
}

fn run_cli(args: Vec<String>) -> i32 {
    match send_external_request("cli", json!({ "argv": args })) {
        Ok(response) => {
            if let Some(code) = print_host_error(&response) {
                return code;
            }
            let value = &response["value"];
            if let Some(lines) = value.get("lines").and_then(Value::as_array) {
                for line in lines.iter().filter_map(Value::as_str) {
                    println!("{line}");
                }
            }
            value
                .get("exitCode")
                .and_then(Value::as_i64)
                .unwrap_or(1) as i32
        }
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn run_mcp() -> i32 {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("Could not read MCP stdin: {error}");
                return 1;
            }
        };
        match send_external_request("mcp_line", json!({ "line": line })) {
            Ok(response) => {
                if let Some(code) = print_host_error(&response) {
                    return code;
                }
                if let Some(output) = response.get("value").and_then(Value::as_str) {
                    println!("{output}");
                }
            }
            Err(error) => {
                eprintln!("{error}");
                return 1;
            }
        }
    }
    0
}

pub fn run_external_mode() -> Option<i32> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--agent-cli") => Some(run_cli(args.collect())),
        Some("--agent-mcp") => Some(run_mcp()),
        _ => None,
    }
}
