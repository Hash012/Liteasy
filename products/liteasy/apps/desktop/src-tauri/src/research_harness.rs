//! Supervised adapter for the original Python kernel; no kernel rewrite or copied library.
//! Configuration belongs to the user. Models cannot choose executable, kit or workspace.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarnessConfig {
    python: PathBuf,
    kit_root: PathBuf,
    workspace: PathBuf,
    fingerprint: Option<String>,
}
fn fingerprint(root: &Path) -> Result<String, String> {
    let mut paths = std::fs::read_dir(root.join("harness"))
        .map_err(|_| "harness_kit_unavailable")?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "harness_kit_unavailable")?;
    paths.sort();
    let mut digest = Sha256::new();
    for path in paths
        .into_iter()
        .filter(|p| p.extension().is_some_and(|v| v == "py"))
    {
        let actual = std::fs::canonicalize(&path).map_err(|_| "harness_kit_unavailable")?;
        if !actual.starts_with(root) {
            return Err("harness_symlink_escape".into());
        }
        let bytes = std::fs::read(&actual).map_err(|_| "harness_kit_unavailable")?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("harness_module_budget".into());
        }
        digest.update(
            path.file_name()
                .ok_or("harness_module_invalid")?
                .to_string_lossy()
                .as_bytes(),
        );
        digest.update(bytes);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn config_path(app: &AppHandle, scope: &str) -> Result<PathBuf, String> {
    Ok(crate::data_location::root(app)?
        .join("research-backend")
        .join(format!(
            "harness-{:x}.json",
            Sha256::digest(scope.as_bytes())
        )))
}
#[tauri::command]
pub fn research_harness_configure(
    app: AppHandle,
    scope: String,
    mut config: HarnessConfig,
) -> Result<Value, String> {
    if crate::desktop_identity::local_object_scope()? != scope {
        return Err("harness_scope_changed".into());
    }
    config.python =
        std::fs::canonicalize(&config.python).map_err(|_| "harness_python_unavailable")?;
    config.kit_root =
        std::fs::canonicalize(&config.kit_root).map_err(|_| "harness_kit_unavailable")?;
    config.workspace =
        std::fs::canonicalize(&config.workspace).map_err(|_| "harness_workspace_unavailable")?;
    if !config.python.is_file()
        || !config.workspace.is_dir()
        || config.workspace.starts_with(&config.kit_root)
        || config.kit_root.starts_with(&config.workspace)
    {
        return Err("harness_requires_separate_workspace".into());
    }
    let info: Value = serde_json::from_slice(
        &std::fs::read(config.kit_root.join("BUILD_INFO.json"))
            .map_err(|_| "harness_version_unavailable")?,
    )
    .map_err(|_| "harness_version_invalid")?;
    if info["version"] != "0.3.0" {
        return Err("harness_version_mismatch_requires_0.3.0".into());
    }
    config.fingerprint = Some(fingerprint(&config.kit_root)?);
    crate::local_library::write_bytes_atomically(
        &config_path(&app, &scope)?,
        &serde_json::to_vec(&config).map_err(|_| "harness_config_invalid")?,
    )?;
    Ok(json!({"configured":true,"version":"0.3.0","fingerprint":config.fingerprint}))
}
const LAUNCHER: &str = r#"
import json,sys
from pathlib import Path
request=json.load(sys.stdin)
sys.path.insert(0, str(Path(request['kit'])/'harness'))
import researchctl
from literature_store import Library
if researchctl.VERSION!='0.3.0': raise RuntimeError('Kernel version mismatch')
try:
    root=Path(request['workspace']); action=request['operation']; key=request.get('recordId')
    store=researchctl.Store(root)
    if action=='verify': result={'research':len(store.records()),'status':store.status()}
    elif action=='literature_audit':
        with Library(root) as library: result=library.audit(key)
    elif action=='create_packet':
        with Library(root) as library:
            packet=library.add('packet',request['packet']); result={'packet':packet,'audit':library.audit(packet['id'])}
    elif action=='claim_audit': result=store.audit(key,False)
    elif action=='execution_preflight':
        record=store.records().get(key)
        if not record or record['kind']!='experiment': raise RuntimeError('Experiment unavailable')
        store.preflight(record); result={'preflight':'passed','experimentId':key}
    elif action=='hypothesis_admission':
        record=store.records().get(key)
        if not record or record['kind']!='hypothesis': raise RuntimeError('Hypothesis unavailable')
        records=store.records(); blockers=[]
        for source in record['nearest_neighbors']:
            blockers.extend(store.literature_blockers(records[source]))
        result={'structuralReady':not blockers,'blockers':blockers,'hypothesisId':key}
    else: raise RuntimeError('Operation denied')
    receipt={'success':True,'result':result}
except Exception as exc:
    receipt={'success':False,'error':str(exc)[:4000]}
print(json.dumps({**receipt,'kernelVersion':researchctl.VERSION,'operation':request['operation'],
 'semanticSupport':'not_independently_verified','authority':'kernel_owned_index'},ensure_ascii=False,allow_nan=False))
"#;
#[tauri::command]
pub async fn research_harness_check(
    app: AppHandle,
    scope: String,
    operation: String,
    record_id: Option<String>,
    packet: Option<Value>,
    task_id: Option<String>,
) -> Result<Value, String> {
    if crate::desktop_identity::local_object_scope()? != scope {
        return Err("harness_scope_changed".into());
    }
    if ![
        "verify",
        "create_packet",
        "literature_audit",
        "claim_audit",
        "execution_preflight",
        "hypothesis_admission",
    ]
    .contains(&operation.as_str())
    {
        return Err("harness_operation_not_permitted".into());
    }
    if operation == "create_packet" {
        let value = packet
            .as_ref()
            .and_then(Value::as_object)
            .ok_or("harness_packet_invalid")?;
        let text_fields = [
            "question",
            "coverage_limitations",
            "critical_synthesis",
            "next_action",
        ];
        let ref_fields = [
            "paper_ids",
            "search_plan_ids",
            "assertion_ids",
            "method_ids",
            "issue_ids",
        ];
        if value
            .keys()
            .any(|key| !text_fields.contains(&key.as_str()) && !ref_fields.contains(&key.as_str()))
        {
            return Err("harness_packet_unknown_field".into());
        }
        for key in text_fields {
            if value
                .get(key)
                .and_then(Value::as_str)
                .is_none_or(|text| text.is_empty() || text.len() > 8000)
            {
                return Err("harness_packet_invalid".into());
            }
        }
        for key in ref_fields {
            let refs = value
                .get(key)
                .and_then(Value::as_array)
                .ok_or("harness_packet_invalid")?;
            if refs.len() > 24
                || refs.iter().any(|item| {
                    item.as_str()
                        .is_none_or(|id| id.is_empty() || id.len() > 160)
                })
            {
                return Err("harness_packet_invalid".into());
            }
        }
    }
    if operation != "verify"
        && operation != "create_packet"
        && record_id.as_ref().is_none_or(|id| {
            id.is_empty()
                || id.len() > 160
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        })
    {
        return Err("harness_record_id_invalid".into());
    }
    let epoch = crate::desktop_identity::authorization_epoch()?;
    let config: HarnessConfig = serde_json::from_slice(
        &std::fs::read(config_path(&app, &scope)?).map_err(|_| "harness_not_configured")?,
    )
    .map_err(|_| "harness_config_invalid")?;
    if config.fingerprint.as_deref() != Some(fingerprint(&config.kit_root)?.as_str()) {
        return Err("harness_kit_changed".into());
    }
    let request = json!({"kit":config.kit_root,"workspace":config.workspace,"operation":operation,"recordId":record_id,"packet":packet});
    let cli_config = config.clone();
    let output = tauri::async_runtime::spawn_blocking(move || run_cli(&cli_config, &request))
        .await
        .map_err(|_| "harness_worker_interrupted".to_string())
        .and_then(|result| result);
    if crate::desktop_identity::local_object_scope()? != scope
        || crate::desktop_identity::authorization_epoch()? != epoch
    {
        return Err("harness_scope_changed".into());
    }
    let mut receipt = match output {
        Ok(value) => value,
        Err(error) => {
            json!({"success":false,"error":error,"kernelVersion":"0.3.0","operation":operation,
            "semanticSupport":"not_independently_verified","authority":"adapter_failure"})
        }
    };
    if config.fingerprint.as_deref() != Some(fingerprint(&config.kit_root)?.as_str()) {
        receipt = json!({"success":false,"error":"harness_kit_changed_during_check","operation":operation,
            "kernelVersion":"0.3.0","authority":"adapter_failure","semanticSupport":"not_independently_verified"});
    }
    receipt["kitFingerprint"] = json!(config.fingerprint);
    receipt["checkedAt"] = json!(chrono::Utc::now().to_rfc3339());
    if let Some(task_id) = task_id {
        crate::research_host::save_harness_receipt(&app, &scope, &task_id, &receipt)?;
    }
    Ok(receipt)
}
fn run_cli(config: &HarnessConfig, request: &Value) -> Result<Value, String> {
    let mut command = Command::new(&config.python);
    command.env_clear().env("PYTHONNOUSERSITE", "1");
    for name in ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    let mut child = command
        .arg("-I")
        .arg("-c")
        .arg(LAUNCHER)
        .current_dir(&config.workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "harness_launch_failed")?;
    let mut input = child.stdin.take().ok_or("harness_stdio_unavailable")?;
    input
        .write_all(request.to_string().as_bytes())
        .map_err(|_| "harness_input_failed")?;
    drop(input);
    let stdout = child.stdout.take().ok_or("harness_stdio_unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let start = Instant::now();
    let success = loop {
        if let Some(status) = child.try_wait().map_err(|_| "harness_status_failed")? {
            break status.success();
        }
        if start.elapsed() > Duration::from_secs(20) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("harness_deadline_exceeded".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let bytes = reader
        .join()
        .map_err(|_| "harness_output_failed")?
        .map_err(|_| "harness_output_failed")?;
    if !success {
        return Err(
            "harness_check_failed: inspect the original kernel workspace; no claim was upgraded"
                .into(),
        );
    }
    if bytes.len() > 1024 * 1024 {
        return Err("harness_output_budget_exhausted".into());
    }
    let receipt: Value = serde_json::from_slice(&bytes).map_err(|_| "harness_output_invalid")?;
    if !receipt["success"].is_boolean()
        || receipt["kernelVersion"] != "0.3.0"
        || receipt["operation"] != request["operation"]
        || receipt["authority"] != "kernel_owned_index"
        || receipt["semanticSupport"] != "not_independently_verified"
        || (receipt["success"] == true && !receipt["result"].is_object())
        || (receipt["success"] == false && !receipt["error"].is_string())
    {
        return Err("harness_output_schema_mismatch".into());
    }
    Ok(receipt)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires explicitly configured original 0.3.0 kit and synthetic workspace"]
    fn original_kernel_roundtrip_and_modified_verifier_rejection() {
        let config = HarnessConfig {
            python: std::env::var("LITEASY_HARNESS_TEST_PYTHON")
                .expect("explicit Python")
                .into(),
            kit_root: std::env::var("LITEASY_HARNESS_TEST_KIT")
                .expect("explicit kit")
                .into(),
            workspace: std::env::var("LITEASY_HARNESS_TEST_WORKSPACE")
                .expect("explicit synthetic workspace")
                .into(),
            fingerprint: None,
        };
        let refs: Value = serde_json::from_slice(
            &std::fs::read(config.workspace.join("fixture-refs.json")).unwrap(),
        )
        .unwrap();
        for (operation, key) in [
            ("verify", ""),
            ("literature_audit", "packetId"),
            ("hypothesis_admission", "hypothesisId"),
            ("execution_preflight", "experimentId"),
            ("create_packet", ""),
        ] {
            let request = json!({"kit":config.kit_root,"workspace":config.workspace,"operation":operation,"recordId":refs[key],"packet":refs["packet"]});
            let actual = run_cli(&config, &request).unwrap();
            assert_eq!(actual["success"], true, "{actual}");
            assert_eq!(actual["kernelVersion"], "0.3.0");
        }
        let request = json!({"kit":config.kit_root,"workspace":config.workspace,"operation":"claim_audit","recordId":"model-invented-claim"});
        assert_eq!(run_cli(&config, &request).unwrap()["success"], false);
        let evaluator = config.workspace.join("eval.txt");
        let original = std::fs::read(&evaluator).unwrap();
        std::fs::write(&evaluator, b"forged evaluator").unwrap();
        let request = json!({"kit":config.kit_root,"workspace":config.workspace,"operation":"execution_preflight","recordId":refs["experimentId"]});
        let actual = run_cli(&config, &request).unwrap();
        std::fs::write(&evaluator, original).unwrap();
        assert_eq!(actual["success"], false);
        assert!(actual["error"]
            .as_str()
            .unwrap()
            .contains("Sealed input changed"));
    }
    #[test]
    fn adapter_calls_protected_original_checks_without_execute_or_network_paths() {
        assert!(LAUNCHER.contains("store.preflight(record)"));
        assert!(LAUNCHER.contains("library.audit(key)"));
        assert!(!LAUNCHER.contains("store.run("));
        assert!(!LAUNCHER.contains("subprocess"));
        assert!(!LAUNCHER.contains("requests."));
    }
}
