//! A pinned, isolated stdio app-server owns the only step loop in a research turn.
//! No default Codex credentials/config, arbitrary shell, workspace reads or API fallback.
use crate::{chatgpt_plan, research_host};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{atomic::Ordering, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{ipc::Channel, AppHandle, Manager, State};
pub const PINNED_VERSION: &str = "0.154.0";
struct Worker {
    child: Child,
    input: ChildStdin,
    scope: String,
    task_id: String,
    epoch: u64,
    plan_epoch: u64,
    expires_at: i64,
    model: String,
    root: PathBuf,
}
#[derive(Default)]
pub struct CodexBackendState(Mutex<HashMap<String, Arc<Mutex<Worker>>>>);
impl CodexBackendState {
    pub fn has_task(&self, task_id: &str) -> Result<bool, String> {
        let workers = self.0.lock().map_err(|_| "codex_host_unavailable")?;
        Ok(workers
            .values()
            .any(|worker| worker.lock().is_ok_and(|worker| worker.task_id == task_id)))
    }
}
fn environment(command: &mut Command) {
    command.env_clear();
    for name in ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
}
fn file_hash(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "codex_executable_unavailable")?;
    if file
        .metadata()
        .map_err(|_| "codex_executable_unavailable")?
        .len()
        > 256 * 1024 * 1024
    {
        return Err("codex_executable_too_large".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|_| "codex_executable_unavailable")?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::data_location::root(app)?
        .join("research-backend")
        .join("codex.json"))
}
#[tauri::command]
pub fn codex_backend_configure(app: AppHandle, executable: String) -> Result<Value, String> {
    let executable =
        std::fs::canonicalize(executable).map_err(|_| "codex_executable_unavailable")?;
    if !executable.is_file() {
        return Err("codex_executable_unavailable".into());
    }
    let mut command = Command::new(&executable);
    environment(&mut command);
    let mut child = command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "codex_version_unavailable")?;
    let start = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|_| "codex_version_unavailable")?
            .is_some()
        {
            break;
        }
        if start.elapsed() > Duration::from_secs(5) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("codex_version_timeout".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut output = String::new();
    child
        .stdout
        .take()
        .ok_or("codex_version_unavailable")?
        .take(4097)
        .read_to_string(&mut output)
        .map_err(|_| "codex_version_unavailable")?;
    if output.trim() != format!("codex-cli {PINNED_VERSION}") {
        return Err(format!("codex_version_mismatch: requires {PINNED_VERSION}"));
    }
    let value =
        json!({"executable":executable,"sha256":file_hash(&executable)?,"version":PINNED_VERSION});
    crate::local_library::write_bytes_atomically(
        &config_path(&app)?,
        value.to_string().as_bytes(),
    )?;
    Ok(json!({"configured":true,"version":PINNED_VERSION}))
}
#[tauri::command]
pub fn codex_backend_capability(app: AppHandle) -> Result<Value, String> {
    let path = config_path(&app)?;
    Ok(
        json!({"configured":path.is_file(),"requiredVersion":PINNED_VERSION,"loopOwner":"codex_app_server","arbitraryShell":false}),
    )
}
fn settings() -> Vec<&'static str> {
    vec![
        r#"model_provider="openai_chatgpt_plan""#,
        r#"model_providers.openai_chatgpt_plan.name="ChatGPT plan""#,
        r#"model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1""#,
        r#"model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN""#,
        r#"model_providers.openai_chatgpt_plan.wire_api="responses""#,
        "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
        "model_providers.openai_chatgpt_plan.supports_websockets=false",
        "features.shell_tool=false",
        "features.unified_exec=false",
        "features.multi_agent=false",
        "features.apps=false",
        r#"web_search="disabled""#,
        r#"shell_environment_policy.inherit="none""#,
        r#"default_permissions="liteasy_research""#,
        r#"permissions.liteasy_research.filesystem={":minimal"="read",":workspace_roots"="deny"}"#,
        "permissions.liteasy_research.network.enabled=false",
        r#"approval_policy="on-request""#,
    ]
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    scope: String,
    task_id: String,
    agent_run_id: String,
    grant_id: String,
    account_id: String,
    model: String,
}
#[tauri::command]
pub async fn codex_backend_start(
    app: AppHandle,
    state: State<'_, CodexBackendState>,
    request: Start,
    events: Channel<Value>,
) -> Result<Value, String> {
    let db = crate::object_store::open(&app, &request.scope)?;
    let grant = research_host::record(&db, &request.scope, &request.grant_id, "outbound_grant")?;
    let epoch = crate::desktop_identity::authorization_epoch()?;
    let plan_epoch = app
        .state::<chatgpt_plan::ChatgptPlanState>()
        .epoch
        .load(Ordering::SeqCst);
    if grant["body"]["taskId"] != request.task_id
        || grant["body"]["accountId"] != request.account_id
        || grant["body"]["model"] != request.model
        || grant["body"]["epoch"].as_u64() != Some(epoch)
        || grant["body"]["bootId"] != research_host::boot_id()
        || grant["body"]["planEpoch"].as_u64() != Some(plan_epoch)
        || grant["body"]["expiresAtUnix"].as_i64().unwrap_or(0) < chrono::Utc::now().timestamp()
    {
        return Err("codex_outbound_grant_invalid".into());
    }
    let refs: Vec<research_host::SourceRef> =
        serde_json::from_value(grant["body"]["sourceRefs"].clone())
            .map_err(|_| "codex_grant_corrupt")?;
    let expires_at = grant["body"]["expiresAtUnix"]
        .as_i64()
        .ok_or("codex_grant_corrupt")?;
    if research_host::source_bindings(&db, &request.scope, &refs)?
        != grant["body"]["sourceBindings"]
    {
        return Err("codex_sources_changed".into());
    }
    let config: Value = serde_json::from_slice(
        &std::fs::read(config_path(&app)?).map_err(|_| "codex_not_configured")?,
    )
    .map_err(|_| "codex_config_invalid")?;
    let executable = PathBuf::from(
        config["executable"]
            .as_str()
            .ok_or("codex_config_invalid")?,
    );
    if file_hash(&executable)? != config["sha256"] {
        return Err("codex_executable_changed".into());
    }
    let token = chatgpt_plan::access_token(&app, &request.scope, &request.account_id).await?;
    if crate::desktop_identity::authorization_epoch()? != epoch
        || app
            .state::<chatgpt_plan::ChatgptPlanState>()
            .epoch
            .load(Ordering::SeqCst)
            != plan_epoch
    {
        return Err("codex_authorization_changed".into());
    }
    let binding = research_host::digest(
        &json!({"scope":request.scope,"account":request.account_id,"taskId":request.task_id,"project":research_host::task(&db,&request.scope,&request.task_id)?["projectRef"],"sourceRefs":grant["body"]["sourceRefs"],"sourceBindings":grant["body"]["sourceBindings"],"model":request.model}),
    )?;
    let root = crate::data_location::root(&app)?
        .join("research-backend")
        .join(binding);
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).map_err(|_| "codex_workspace_unavailable")?;
    std::fs::create_dir_all(root.join("codex-home")).map_err(|_| "codex_workspace_unavailable")?;
    let mut command = Command::new(executable);
    environment(&mut command);
    command
        .env("CODEX_HOME", root.join("codex-home"))
        .env("ACCESS_TOKEN", token)
        .current_dir(&workspace)
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://");
    for setting in settings() {
        command.arg("-c").arg(setting);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "codex_start_failed")?;
    let output = child.stdout.take().ok_or("codex_stdio_unavailable")?;
    let error = child.stderr.take().ok_or("codex_stdio_unavailable")?;
    let input = child.stdin.take().ok_or("codex_stdio_unavailable")?;
    let pid = child.id();
    let worker_id = format!(
        "codex-{pid}-{}",
        openidconnect::Nonce::new_random().secret()
    );
    if request.agent_run_id.is_empty() || request.agent_run_id.len() > 160 {
        let _ = child.kill();
        return Err("codex_agent_run_invalid".into());
    }
    if let Err(error) = research_host::begin_backend(
        &db,
        &request.scope,
        &request.task_id,
        &request.grant_id,
        &worker_id,
        &request.agent_run_id,
    ) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let worker = Arc::new(Mutex::new(Worker {
        child,
        input,
        scope: request.scope.clone(),
        task_id: request.task_id.clone(),
        epoch,
        plan_epoch,
        expires_at,
        model: request.model,
        root: workspace,
    }));
    state
        .0
        .lock()
        .map_err(|_| "codex_host_unavailable")?
        .insert(worker_id.clone(), worker.clone());
    // Drain stderr without putting prompts, credential-bearing provider diagnostics or paths in logs.
    std::thread::spawn(move || {
        let mut reader = error;
        let mut buffer = [0u8; 4096];
        while reader.read(&mut buffer).unwrap_or(0) > 0 {}
    });
    let watchdog = worker.clone();
    let watchdog_host = app.clone();
    let stop_reason = Arc::new(Mutex::new(None::<String>));
    let watchdog_reason = stop_reason.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let Ok(mut worker) = watchdog.lock() else {
                break;
            };
            if worker.child.try_wait().ok().flatten().is_some() {
                break;
            }
            let exhausted = deadline.elapsed() > Duration::from_secs(180);
            let revoked = crate::desktop_identity::authorization_epoch() != Ok(epoch)
                || chrono::Utc::now().timestamp() > expires_at
                || watchdog_host
                    .state::<chatgpt_plan::ChatgptPlanState>()
                    .epoch
                    .load(Ordering::SeqCst)
                    != plan_epoch;
            if exhausted || revoked {
                if let Ok(mut reason) = watchdog_reason.lock() {
                    *reason = Some(
                        if exhausted {
                            "exhausted"
                        } else {
                            "interrupted"
                        }
                        .into(),
                    );
                }
                let _ = worker.child.kill();
                break;
            }
        }
    });
    let lease_scope = request.scope.clone();
    let lease_task = request.task_id.clone();
    let lease_worker = worker_id.clone();
    let lease_host = app.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut reader = BufReader::new(output);
        let mut count = 0usize;
        let mut tool_calls = 0usize;
        let mut usage = Value::Null;
        let mut terminal_status = String::from("interrupted");
        loop {
            let mut line = Vec::new();
            let read = reader
                .by_ref()
                .take(8 * 1024 * 1024 + 1)
                .read_until(b'\n', &mut line);
            if read.is_err() || line.is_empty() {
                break;
            }
            count += line.len();
            if line.len() > 8 * 1024 * 1024 || count > 32 * 1024 * 1024 {
                terminal_status = "exhausted".into();
                break;
            }
            let value = match serde_json::from_slice::<Value>(&line) {
                Ok(v) => v,
                Err(_) => break,
            };
            if crate::desktop_identity::local_object_scope().as_deref() != Ok(lease_scope.as_str())
                || crate::desktop_identity::authorization_epoch() != Ok(epoch)
                || lease_host
                    .state::<chatgpt_plan::ChatgptPlanState>()
                    .epoch
                    .load(Ordering::SeqCst)
                    != plan_epoch
            {
                break;
            }
            if let Some(thread_id) = value["result"]["thread"]["id"].as_str().or_else(|| {
                if value["method"] == "thread/started" {
                    value["params"]["thread"]["id"].as_str()
                } else {
                    None
                }
            }) {
                if research_host::checkpoint_backend(
                    &db,
                    &lease_scope,
                    &lease_task,
                    &lease_worker,
                    thread_id,
                    &grant,
                )
                .is_err()
                {
                    terminal_status = "failed".into();
                    break;
                }
            }
            if value["method"] == "thread/tokenUsage/updated" {
                usage = value["params"]["tokenUsage"]["last"].clone();
            }
            if value["method"] == "item/tool/call" {
                tool_calls += 1;
                if tool_calls > 24 {
                    terminal_status = "exhausted".into();
                    break;
                }
            }
            if value["method"] == "turn/completed" {
                terminal_status = value["params"]["turn"]["status"]
                    .as_str()
                    .unwrap_or("interrupted")
                    .to_string();
            }
            if events.send(value).is_err() {
                break;
            }
        }
        if let Ok(mut worker) = worker.lock() {
            let _ = worker.child.kill();
            let _ = worker.child.wait();
        }
        if let Ok(reason) = stop_reason.lock() {
            if let Some(reason) = reason.as_ref() {
                terminal_status = reason.clone();
            }
        }
        let _ = research_host::finish_backend(
            &db,
            &lease_scope,
            &lease_task,
            &lease_worker,
            &terminal_status,
            &json!({"wallMs":started.elapsed().as_millis() as u64,"toolCalls":tool_calls,"outputBytes":count,
                "usage":usage,"usageStatus":if usage.is_null(){"unavailable"}else{"reported_by_provider"},"monetaryCost":null}),
        );
        if let Ok(mut workers) = lease_host.state::<CodexBackendState>().0.lock() {
            workers.remove(&lease_worker);
        }
        let _ = events
            .send(json!({"method":"liteasy/backend-ended","params":{"status":terminal_status}}));
    });
    Ok(json!({"workerId":worker_id,"version":PINNED_VERSION}))
}
fn bounded_message(mut message: Value, worker: &Worker) -> Result<Value, String> {
    if message.to_string().len() > 4 * 1024 * 1024 {
        return Err("codex_input_too_large".into());
    }
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);
    match method.as_deref() {
        Some("initialize" | "initialized" | "turn/interrupt") => (),
        Some("thread/start" | "thread/resume") => {
            message["params"]["model"] = json!(worker.model);
            message["params"]["modelProvider"] = json!("openai_chatgpt_plan");
            message["params"]["allowProviderModelFallback"] = json!(false);
            message["params"]["permissions"] = json!("liteasy_research");
            message["params"]["approvalPolicy"] = json!("on-request");
            message["params"]["approvalsReviewer"] = json!("user");
            message["params"]["cwd"] = json!(worker.root);
            message["params"]["environments"] = json!([]);
            if let Some(p) = message["params"].as_object_mut() {
                p.remove("sandbox");
                p.remove("config");
                p.remove("runtimeWorkspaceRoots");
            }
        }
        Some("turn/start") => {
            message["params"]["model"] = json!(worker.model);
            message["params"]["cwd"] = json!(worker.root);
            if let Some(p) = message["params"].as_object_mut() {
                p.remove("sandboxPolicy");
                p.remove("approvalPolicy");
                p.remove("approvalsReviewer");
                p.remove("environments");
            }
        }
        None if message.get("id").is_some()
            && (message.get("result").is_some() || message.get("error").is_some()) =>
        {
            ()
        }
        _ => return Err("codex_method_not_permitted".into()),
    }
    Ok(message)
}
#[tauri::command]
pub fn codex_backend_send(
    app: AppHandle,
    state: State<'_, CodexBackendState>,
    worker_id: String,
    message: Value,
) -> Result<(), String> {
    let worker = state
        .0
        .lock()
        .map_err(|_| "codex_host_unavailable")?
        .get(&worker_id)
        .cloned()
        .ok_or("codex_worker_missing")?;
    let mut worker = worker.lock().map_err(|_| "codex_host_unavailable")?;
    if crate::desktop_identity::local_object_scope()? != worker.scope
        || crate::desktop_identity::authorization_epoch()? != worker.epoch
        || chrono::Utc::now().timestamp() > worker.expires_at
        || app
            .state::<chatgpt_plan::ChatgptPlanState>()
            .epoch
            .load(Ordering::SeqCst)
            != worker.plan_epoch
    {
        let _ = worker.child.kill();
        return Err("codex_authorization_changed".into());
    }
    let message = bounded_message(message, &worker)?;
    serde_json::to_writer(&mut worker.input, &message).map_err(|_| "codex_stdio_closed")?;
    worker
        .input
        .write_all(b"\n")
        .and_then(|_| worker.input.flush())
        .map_err(|_| "codex_stdio_closed".into())
}
#[tauri::command]
pub fn codex_backend_stop(
    state: State<'_, CodexBackendState>,
    worker_id: String,
) -> Result<(), String> {
    if let Some(worker) = state
        .0
        .lock()
        .map_err(|_| "codex_host_unavailable")?
        .remove(&worker_id)
    {
        let mut worker = worker.lock().map_err(|_| "codex_host_unavailable")?;
        let _ = worker.child.kill();
        let _ = worker.child.wait();
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn research_process_disables_shell_agent_fanout_and_inherited_secrets() {
        let config = settings().join("\n");
        assert!(config.contains("features.shell_tool=false"));
        assert!(config.contains("features.multi_agent=false"));
        assert!(config.contains(r#"shell_environment_policy.inherit="none""#));
        assert!(config.contains(r#"":workspace_roots"="deny""#));
        assert!(!config.contains("backend-api"));
        assert!(config.contains("supports_websockets=false"));
    }
}
