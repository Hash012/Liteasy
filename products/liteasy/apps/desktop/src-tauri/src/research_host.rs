//! Host-owned task/job authority in the existing account-partitioned object database.
//! Models can propose drafts. They cannot issue grants, measured run IDs or human approvals.
use crate::research_runner::{self, ReplaySpec};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct ResearchHostState {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
// Process epochs alone restart at zero. A persisted grant must never become valid
// again after a cold start, even when its wall-clock expiry has not been reached.
pub(crate) fn boot_id() -> &'static str {
    static BOOT: OnceLock<String> = OnceLock::new();
    BOOT.get_or_init(|| id("boot"))
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRef {
    pub object_id: String,
    pub revision: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTask {
    project_ref: SourceRef,
    parent_session_ref: Option<String>,
    goal: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DraftHypothesis {
    task_id: String,
    question: String,
    proposed_mechanism: String,
    changed_assumption: String,
    nearest_baselines: Vec<String>,
    applicability_conditions: Vec<String>,
    predictions: Vec<String>,
    falsification_criteria: Vec<String>,
    literature_refs: Vec<SourceRef>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareSpec {
    task_id: String,
    hypothesis_id: String,
    replay: ReplaySpec,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approve {
    task_id: String,
    spec_id: String,
    expected_spec_hash: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Submit {
    task_id: String,
    spec_id: String,
    grant_id: String,
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Query {
    task_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunQuery {
    run_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Decision {
    task_id: String,
    run_id: String,
    action: String,
    rationale: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HumanConfirmation {
    task_id: String,
    claim_id: String,
    expected_claim_hash: String,
}
pub fn digest(value: &Value) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|_| "invalid_json")?)
    ))
}
fn id(prefix: &str) -> String {
    format!("{prefix}-{}", openidconnect::Nonce::new_random().secret())
}
fn now() -> String {
    Utc::now().to_rfc3339()
}
fn initialize(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS research_records(scope TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(scope,id));
         CREATE TABLE IF NOT EXISTS research_tasks(scope TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,id));
         CREATE TABLE IF NOT EXISTS research_jobs(scope TEXT NOT NULL,id TEXT NOT NULL,task_id TEXT NOT NULL,spec_id TEXT NOT NULL,operation_key TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,task_id,operation_key));
         CREATE UNIQUE INDEX IF NOT EXISTS research_single_grant ON research_jobs(scope,json_extract(body,'$.grantId')) WHERE json_extract(body,'$.grantId') IS NOT NULL;
         CREATE TABLE IF NOT EXISTS research_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,task_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS research_code_snapshots(scope TEXT NOT NULL,sha256 TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(scope,sha256));"
    ).map_err(|e| e.to_string())
}
fn store_record(
    db: &Connection,
    scope: &str,
    kind: &str,
    mut body: Value,
) -> Result<Value, String> {
    let count:i64=db.query_row("SELECT COUNT(*) FROM research_records WHERE scope=?1 AND kind=?2 AND json_extract(body,'$.taskId')=?3",params![scope,kind,body["taskId"].as_str()],|r|r.get(0)).map_err(|e|e.to_string())?;
    if count >= 64 {
        return Err("research_record_budget_exhausted".into());
    }
    let rid = id(kind);
    body["id"] = json!(rid);
    body["createdAt"] = json!(now());
    let hash = digest(&body)?;
    db.execute(
        "INSERT INTO research_records(scope,id,kind,body,hash) VALUES(?1,?2,?3,?4,?5)",
        params![scope, rid, kind, body.to_string(), hash],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({"id":rid,"hash":hash,"kind":kind,"body":body}))
}
pub(crate) fn record(db: &Connection, scope: &str, rid: &str, kind: &str) -> Result<Value, String> {
    let (body, hash): (String, String) = db
        .query_row(
            "SELECT body,hash FROM research_records WHERE scope=?1 AND id=?2 AND kind=?3",
            params![scope, rid, kind],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "record_not_found")?;
    let value: Value = serde_json::from_str(&body).map_err(|_| "corrupt_record")?;
    if digest(&value)? != hash {
        return Err("record_hash_mismatch".into());
    }
    Ok(json!({"id":rid,"hash":hash,"kind":kind,"body":value}))
}
pub(crate) fn task(db: &Connection, scope: &str, tid: &str) -> Result<Value, String> {
    let body: String = db
        .query_row(
            "SELECT body FROM research_tasks WHERE scope=?1 AND id=?2",
            params![scope, tid],
            |r| r.get(0),
        )
        .map_err(|_| "task_not_found")?;
    serde_json::from_str(&body).map_err(|_| "corrupt_task".into())
}
fn save_task(db: &Connection, scope: &str, body: &mut Value) -> Result<(), String> {
    body["checkpointRevision"] = json!(body["checkpointRevision"].as_u64().unwrap_or(0) + 1);
    body["updatedAt"] = json!(now());
    db.execute(
        "UPDATE research_tasks SET body=?1 WHERE scope=?2 AND id=?3",
        params![body.to_string(), scope, body["taskId"].as_str()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn event(db: &Connection, scope: &str, tid: &str, kind: &str, body: &Value) -> Result<(), String> {
    db.execute(
        "INSERT INTO research_events(scope,task_id,kind,body) VALUES(?1,?2,?3,?4)",
        params![scope, tid, kind, body.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn source(db: &Connection, scope: &str, reference: &SourceRef) -> Result<Value, String> {
    if reference.object_id.len() > 512 || reference.revision.len() > 512 {
        return Err("invalid_source_ref".into());
    }
    let key = format!("revision/{}/{}", reference.object_id, reference.revision);
    let body: String = db
        .query_row(
            "SELECT value FROM object_records WHERE scope=?1 AND key=?2",
            params![scope, key],
            |r| r.get(0),
        )
        .map_err(|_| "source_revision_unavailable")?;
    let value: Value = serde_json::from_str(&body).map_err(|_| "source_corrupt")?;
    if value["objectId"] != reference.object_id
        || value["revision"] != reference.revision
        || value["scopeId"] != scope
    {
        return Err("source_revision_mismatch".into());
    }
    Ok(value)
}
fn text(value: &Value) -> Result<String, String> {
    let payload = &value["content"]["payload"];
    if value["kind"] == "source.document"
        && payload["legacyKey"]
            .as_str()
            .is_some_and(|s| s.starts_with("paper-context-metadata:"))
    {
        return Err("metadata_is_not_source_body".into());
    }
    match value["kind"].as_str() {
        Some("content.note" | "source.document" | "content.fragment" | "conversation.message") => {
            payload["text"]
                .as_str()
                .map(str::to_string)
                .ok_or("source_has_no_body".into())
        }
        Some("artifact.document") => Ok(payload["blocks"]
            .as_array()
            .ok_or("source_has_no_body")?
            .iter()
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n\n")),
        _ => Err("source_body_not_supported".into()),
    }
}
fn bounded(value: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max {
        Err("invalid_text_budget".into())
    } else {
        Ok(())
    }
}
fn validate_packet(
    db: &Connection,
    scope: &str,
    tid: &str,
    references: &[SourceRef],
) -> Result<(), String> {
    if references.is_empty() || references.len() > 12 {
        return Err("literature_packet_required".into());
    }
    for reference in references {
        let actual = source(db, scope, reference)?;
        let hash = digest(&actual)?;
        let read: i64=db.query_row("SELECT COUNT(*) FROM research_events WHERE scope=?1 AND task_id=?2 AND kind='source_read' AND json_extract(body,'$.sourceHash')=?3",
            params![scope,tid,hash],|r|r.get(0)).map_err(|e|e.to_string())?;
        if read == 0 {
            return Err("unread_source: record a real scoped read before admission".into());
        }
    }
    Ok(())
}
fn read_spans(db: &Connection, scope: &str, tid: &str) -> Result<Vec<Value>, String> {
    let mut statement=db.prepare("SELECT sequence,body FROM research_events WHERE scope=?1 AND task_id=?2 AND kind='source_read' ORDER BY sequence DESC LIMIT 64").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map(params![scope, tid], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| { let (sequence,body)=row.map_err(|e|e.to_string())?;let body:Value=serde_json::from_str(&body).map_err(|_|"corrupt_read")?;
        Ok(json!({"receiptId":sequence,"reference":if body["ref"].is_null(){&body["reference"]}else{&body["ref"]},"sourceHash":body["sourceHash"],"offset":body["offset"],"endOffset":body["endOffset"],"offsetUnit":body["offsetUnit"],"coverage":"partial","semanticSupport":"not_assessed"}))
    }).collect()
}
fn packet_spans(
    db: &Connection,
    scope: &str,
    tid: &str,
    refs: &[SourceRef],
) -> Result<Vec<Value>, String> {
    let bindings = source_bindings(db, scope, refs)?;
    Ok(read_spans(db, scope, tid)?
        .into_iter()
        .filter(|span| {
            bindings.as_array().is_some_and(|items| {
                items.iter().any(|binding| {
                    binding["reference"] == span["reference"]
                        && binding["sha256"] == span["sourceHash"]
                })
            })
        })
        .collect())
}
pub(crate) fn source_bindings(
    db: &Connection,
    scope: &str,
    references: &[SourceRef],
) -> Result<Value, String> {
    references
        .iter()
        .map(|reference| {
            Ok(json!({"reference":reference,"sha256":digest(&source(db,scope,reference)?)?}))
        })
        .collect::<Result<Vec<Value>, String>>()
        .map(Value::Array)
}
pub(crate) fn begin_backend(
    db: &Connection,
    scope: &str,
    tid: &str,
    grant_id: &str,
    worker_id: &str,
    agent_run_id: &str,
) -> Result<(), String> {
    let transaction = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let used:i64=db.query_row("SELECT COUNT(*) FROM research_records WHERE scope=?1 AND kind='backend_intent' AND json_extract(body,'$.grantId')=?2",params![scope,grant_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if used > 0 {
        return Err("codex_grant_consumed: approve a new turn explicitly".into());
    }
    let mut current = task(db, scope, tid)?;
    if matches!(current["state"].as_str(), Some("running" | "waiting_job")) {
        return Err("task_execution_in_progress".into());
    }
    let attempts: i64 = db.query_row("SELECT COUNT(*) FROM research_records WHERE scope=?1 AND kind='backend_intent' AND json_extract(body,'$.taskId')=?2",
        params![scope,tid], |row| row.get(0)).map_err(|e| e.to_string())?;
    if attempts >= 6 {
        current["state"] = json!("exhausted");
        save_task(db, scope, &mut current)?;
        transaction.commit().map_err(|e| e.to_string())?;
        return Err("research_model_budget_exhausted".into());
    }
    store_record(
        db,
        scope,
        "backend_intent",
        json!({"taskId":tid,"grantId":grant_id,"workerId":worker_id,"agentRunId":agent_run_id,"status":"running"}),
    )?;
    current["state"] = json!("running");
    current["budget"]["usedModelTurns"] = json!(attempts + 1);
    current["backendRunRefs"]
        .as_array_mut()
        .ok_or("corrupt_task")?
        .push(json!({"backend":"codex_app_server","workerId":worker_id,"agentRunId":agent_run_id}));
    save_task(db, scope, &mut current)?;
    transaction.commit().map_err(|e| e.to_string())
}
pub(crate) fn finish_backend(
    db: &Connection,
    scope: &str,
    tid: &str,
    worker_id: &str,
    status: &str,
    cost: &Value,
) -> Result<(), String> {
    let transaction = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut current = task(db, scope, tid)?;
    store_record(
        db,
        scope,
        "backend_terminal",
        json!({"taskId":tid,"workerId":worker_id,"status":status,"cost":cost}),
    )?;
    current["state"] = json!(if status == "completed" {
        "waiting_user"
    } else if status == "exhausted" {
        "exhausted"
    } else {
        "interrupted"
    });
    save_task(db, scope, &mut current)?;
    transaction.commit().map_err(|e| e.to_string())
}
pub(crate) fn checkpoint_backend(
    db: &Connection,
    scope: &str,
    tid: &str,
    worker_id: &str,
    thread_id: &str,
    grant: &Value,
) -> Result<(), String> {
    bounded(thread_id, 160)?;
    let exists: i64 = db.query_row(
        "SELECT COUNT(*) FROM research_records WHERE scope=?1 AND kind='backend_checkpoint' AND json_extract(body,'$.workerId')=?2 AND json_extract(body,'$.threadId')=?3",
        params![scope,worker_id,thread_id], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if exists == 0 {
        store_record(
            db,
            scope,
            "backend_checkpoint",
            json!({
                "taskId":tid,"workerId":worker_id,"threadId":thread_id,"status":"resumable_thread",
                "accountId":grant["body"]["accountId"],"model":grant["body"]["model"],
                "sourceRefs":grant["body"]["sourceRefs"],"sourceBindings":grant["body"]["sourceBindings"]
            }),
        )?;
    }
    Ok(())
}
pub(crate) fn save_harness_receipt(
    app: &AppHandle,
    scope: &str,
    tid: &str,
    receipt: &Value,
) -> Result<(), String> {
    let db = crate::object_store::open(app, scope)?;
    initialize(&db)?;
    let mut current = task(&db, scope, tid)?;
    store_record(
        &db,
        scope,
        "harness_receipt",
        json!({"taskId":tid,"receipt":receipt}),
    )?;
    save_task(&db, scope, &mut current)
}
fn records(db: &Connection, scope: &str, tid: &str) -> Result<Vec<Value>, String> {
    let mut statement=db.prepare("SELECT kind,body,hash,id FROM research_records WHERE scope=?1 AND json_extract(body,'$.taskId')=?2 ORDER BY rowid").map_err(|e|e.to_string())?;
    let records = statement
        .query_map(params![scope, tid], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .map(|row| {
            let (k, b, h, i) = row.map_err(|e| e.to_string())?;
            let body = serde_json::from_str::<Value>(&b).map_err(|_| "corrupt_record")?;
            if digest(&body)? != h {
                return Err("record_hash_mismatch".into());
            }
            Ok(json!({"kind":k,"body":body,"hash":h,"id":i}))
        })
        .collect::<Result<Vec<Value>, String>>()?;
    Ok(records)
}

fn job(db: &Connection, scope: &str, rid: &str) -> Result<Value, String> {
    let body: String = db
        .query_row(
            "SELECT body FROM research_jobs WHERE scope=?1 AND id=?2",
            params![scope, rid],
            |r| r.get(0),
        )
        .map_err(|_| "run_not_found")?;
    serde_json::from_str(&body).map_err(|_| "run_corrupt".into())
}
fn update_job(db: &Connection, scope: &str, body: &Value) -> Result<(), String> {
    db.execute(
        "UPDATE research_jobs SET status=?1,body=?2 WHERE scope=?3 AND id=?4",
        params![
            body["status"].as_str(),
            body.to_string(),
            scope,
            body["runId"].as_str()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn record_decision(db: &Connection, scope: &str, request: Decision) -> Result<Value, String> {
    bounded(&request.rationale, 4000)?;
    if !["continue", "narrow", "stop", "reopen"].contains(&request.action.as_str()) {
        return Err("invalid_decision".into());
    }
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let run = job(&tx, scope, &request.run_id)?;
    if run["taskId"] != request.task_id {
        return Err("run_task_mismatch".into());
    }
    if matches!(run["status"].as_str(), Some("running" | "submitting")) {
        return Err("wait_for_experiment_terminal".into());
    }
    let mut current = task(&tx, scope, &request.task_id)?;
    if matches!(current["state"].as_str(), Some("running" | "waiting_job")) {
        return Err("task_execution_in_progress".into());
    }
    // Validate all authority links before appending either a decision or a claim.
    let spec = if run["status"] == "completed" {
        let spec = record(
            &tx,
            scope,
            run["specId"].as_str().ok_or("invalid_run")?,
            "spec",
        )?;
        if run["origin"] != "host_measured"
            || digest(&run["rawResult"])? != run["resultHash"]
            || run["rawResult"]["correctnessPassed"] != true
            || run["specHash"] != spec["hash"]
            || spec["body"]["taskId"] != request.task_id
            || run["rawResult"]["validatorVersion"] != spec["body"]["replay"]["validatorVersion"]
            || run["rawResult"]["codeSnapshot"] != spec["body"]["replay"]["codeSnapshot"]
        {
            return Err("official_validation_required".into());
        }
        Some(spec)
    } else {
        if request.action == "narrow" {
            return Err("completed_measurement_required".into());
        }
        None
    };
    let decision = store_record(
        &tx,
        scope,
        "decision",
        json!({
            "taskId":request.task_id,"runRef":request.run_id,"action":request.action,
            "rationale":request.rationale,"resultHash":run["resultHash"]
        }),
    )?;
    let claim = if let Some(spec) = spec {
        store_record(
            &tx,
            scope,
            "claim",
            json!({
                "taskId":request.task_id,"runRef":request.run_id,"resultHash":run["resultHash"],
                "specHash":run["specHash"],"hypothesisRef":spec["body"]["hypothesisRef"],
                "conditions":run["rawResult"]["conditions"],"status":run["rawResult"]["conditionalStatus"],
                "structuralCheck":"passed","semanticSupport":"human_review_required",
                "experimentValidation":{"kind":"cpu_simulation","validatorVersion":run["rawResult"]["validatorVersion"],"codeSnapshot":run["rawResult"]["codeSnapshot"]},
                "evidenceSpans":spec["body"]["literaturePacket"]["spans"],"humanConfirmation":null,
                "novelty":"not_assessed","decisionRef":decision["id"]
            }),
        )?
    } else {
        Value::Null
    };
    let continuing = matches!(request.action.as_str(), "continue" | "reopen");
    current["state"] = json!(if continuing {
        "waiting_user"
    } else {
        "completed"
    });
    current["taskBrief"]["nextCheck"] = json!(if continuing {
        "根据本次结果修改假设或设计反例；新实验需要重新批准固定规格。"
    } else {
        "本任务的决策已交付；请保留原始证据，交付完成不代表科学主张为真。"
    });
    current["taskBrief"]["decisionRef"] = json!({"id":decision["id"],"hash":decision["hash"]});
    save_task(&tx, scope, &mut current)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"decision":decision,"claim":claim}))
}
fn finalize_inner(
    db: &Connection,
    scope: &str,
    rid: &str,
    outcome: Result<Value, String>,
    runner_wall_us: Option<u64>,
) -> Result<Value, String> {
    let mut run = job(db, scope, rid)?;
    let tid = run["taskId"].as_str().ok_or("invalid_run")?.to_string();
    if !matches!(run["status"].as_str(), Some("submitting" | "running")) {
        return Ok(run);
    }
    match outcome {
        Ok(result) => {
            run["status"] = json!("completed");
            run["resultHash"] = json!(digest(&result)?);
            run["rawResult"] = result;
        }
        Err(reason) => {
            run["status"] = json!(if reason == "cancelled" {
                "cancelled"
            } else if reason == "exhausted" {
                "exhausted"
            } else if reason == "permission_revoked" || reason.starts_with("host_restarted:") {
                "interrupted"
            } else {
                "failed"
            });
            run["error"] = json!(reason);
        }
    }
    run["finishedAt"] = json!(now());
    run["cost"]["runnerWallUs"] = json!(runner_wall_us);
    run["cost"]["measurement"] = json!(if runner_wall_us.is_some() {
        "host_clock"
    } else {
        "unavailable_after_interruption"
    });
    update_job(db, scope, &run)?;
    let mut current = task(db, scope, &tid)?;
    current["state"] = json!(if run["status"] == "completed" {
        "waiting_user"
    } else if run["status"] == "exhausted" {
        "exhausted"
    } else {
        "interrupted"
    });
    current["taskBrief"]["nextCheck"] =
        json!("先核对原始结果、正确性和独立工作负载的适用范围，再审阅条件化主张。");
    let brief_ref = json!({"runId":rid,"specId":run["specId"],"resultHash":run["resultHash"],"status":run["status"]});
    let group = if run["status"] == "completed" {
        "facts"
    } else {
        "failedExperiments"
    };
    if current["taskBrief"][group].is_null() {
        current["taskBrief"][group] = json!([]);
    }
    current["taskBrief"][group]
        .as_array_mut()
        .ok_or("corrupt_brief")?
        .push(brief_ref);
    if run["status"] == "completed" {
        current["taskBrief"]["counterexamples"] = run["rawResult"]["conditions"].clone();
    }
    current["taskBrief"]["remainingRuns"] =
        json!(6_u64.saturating_sub(current["budget"]["usedRuns"].as_u64().unwrap_or(6)));
    save_task(db, scope, &mut current)?;
    event(db, scope, &tid, "run_terminal", &run)?;
    Ok(run)
}
fn finalize(
    db: &Connection,
    scope: &str,
    rid: &str,
    outcome: Result<Value, String>,
) -> Result<Value, String> {
    finalize_timed(db, scope, rid, outcome, None)
}
fn finalize_timed(
    db: &Connection,
    scope: &str,
    rid: &str,
    outcome: Result<Value, String>,
    runner_wall_us: Option<u64>,
) -> Result<Value, String> {
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let value = finalize_inner(&tx, scope, rid, outcome, runner_wall_us)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
pub async fn research_host_command(
    app: AppHandle,
    state: State<'_, ResearchHostState>,
    scope: String,
    operation: String,
    payload: Value,
) -> Result<Value, String> {
    let mut db = crate::object_store::open(&app, &scope)?;
    initialize(&db)?;
    match operation.as_str() {
        "capability" => Ok(
            json!({"runner":"bounded_cpu_trace_replay","validatorVersion":research_runner::VALIDATOR_VERSION,"codeSnapshot":research_runner::code_digest(),"arbitraryCodeExecution":false}),
        ),
        "runner_source" => {
            let hash = payload["codeSnapshot"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(research_runner::code_digest);
            let source: String = if hash == research_runner::code_digest() {
                include_str!("research_runner.rs").into()
            } else {
                db.query_row(
                    "SELECT source FROM research_code_snapshots WHERE scope=?1 AND sha256=?2",
                    params![scope, hash],
                    |r| r.get(0),
                )
                .map_err(|_| "runner_snapshot_unavailable")?
            };
            if format!("{:x}", Sha256::digest(source.as_bytes())) != hash {
                return Err("runner_snapshot_tampered".into());
            }
            Ok(json!({"source":source,"sha256":hash}))
        }
        "list" => {
            let mut statement = db
                .prepare(
                    "SELECT body FROM research_tasks WHERE scope=?1 ORDER BY rowid DESC LIMIT 200",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map(params![scope], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            let mut values = Vec::new();
            for row in rows {
                values.push(
                    serde_json::from_str::<Value>(&row.map_err(|e| e.to_string())?)
                        .map_err(|_| "corrupt_task")?,
                );
            }
            Ok(json!(values))
        }
        "create_task" => {
            let request: CreateTask =
                serde_json::from_value(payload).map_err(|_| "invalid_task")?;
            bounded(&request.goal, 4000)?;
            source(&db, &scope, &request.project_ref)?;
            let tid = id("task");
            let body = json!({"schema":"liteasy.research-task/v1","taskId":tid,"projectRef":request.project_ref,
                "parentSessionRef":request.parent_session_ref,"goal":request.goal,"state":"waiting_user","activeHypothesisRefs":[],
                "budget":{"maxRuns":6,"usedRuns":0,"maxRunnerSeconds":10,"maxModelTurns":6,"usedModelTurns":0,"maxModelTurnSeconds":180,"maxToolCallsPerTurn":24,"externalInference":"explicit_grant_required"},
                "permissionGrantRef":null,"checkpointRevision":1,"backendRunRefs":[],"createdAt":now(),
                "taskBrief":{"goal":request.goal,"facts":[],"hypotheses":[],"counterexamples":[],"failedExperiments":[],"openQuestions":[],
                    "nextCheck":"读取固定版本的来源，并保存可相互竞争的推测假设。","permissionRef":null}});
            db.execute(
                "INSERT INTO research_tasks(scope,id,body) VALUES(?1,?2,?3)",
                params![scope, tid, body.to_string()],
            )
            .map_err(|e| e.to_string())?;
            Ok(body)
        }
        "get" => {
            let q: Query = serde_json::from_value(payload).map_err(|_| "invalid_query")?;
            let mut current = task(&db, &scope, &q.task_id)?;
            if current["state"] == "running"
                && !app
                    .state::<crate::codex_backend::CodexBackendState>()
                    .has_task(&q.task_id)?
            {
                current["state"] = json!("interrupted");
                event(
                    &db,
                    &scope,
                    &q.task_id,
                    "backend_recovery",
                    &json!({"reason":"host_restarted","autoResubmit":false}),
                )?;
                save_task(&db, &scope, &mut current)?;
            }
            let records = records(&db, &scope, &q.task_id)?;
            let mut statement = db
                .prepare(
                    "SELECT id FROM research_jobs WHERE scope=?1 AND task_id=?2 ORDER BY rowid",
                )
                .map_err(|e| e.to_string())?;
            let ids = statement
                .query_map(params![scope, q.task_id], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let mut jobs = Vec::new();
            for rid in ids {
                let run = job(&db, &scope, &rid)?;
                if matches!(run["status"].as_str(), Some("running" | "submitting"))
                    && !state
                        .jobs
                        .lock()
                        .map_err(|_| "host_unavailable")?
                        .contains_key(&rid)
                {
                    jobs.push(finalize(
                        &db,
                        &scope,
                        &rid,
                        Err("host_restarted: reconcile; never resubmit automatically".into()),
                    )?);
                } else {
                    if run["status"] == "completed"
                        && digest(&run["rawResult"])? != run["resultHash"]
                    {
                        return Err("measured_result_tampered".into());
                    }
                    jobs.push(run);
                }
            }
            Ok(
                json!({"task":if jobs.is_empty(){current}else{task(&db,&scope,&q.task_id)?},"records":records,"runs":jobs}),
            )
        }
        "read_source" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Read {
                task_id: String,
                reference: SourceRef,
                offset: usize,
            }
            let request: Read = serde_json::from_value(payload).map_err(|_| "invalid_read")?;
            task(&db, &scope, &request.task_id)?;
            let actual = source(&db, &scope, &request.reference)?;
            let content = text(&actual)?;
            let chars: Vec<char> = content.chars().collect();
            if request.offset > chars.len() {
                return Err("invalid_offset".into());
            }
            let end = (request.offset + 12_000).min(chars.len());
            let result = json!({"ref":request.reference,"sourceHash":digest(&actual)?,
                "offset":request.offset,"endOffset":end,"offsetUnit":"unicode_scalars","text":chars[request.offset..end].iter().collect::<String>(),"nextOffset":if end<chars.len(){Some(end)}else{None}});
            if end > request.offset {
                event(&db, &scope, &request.task_id, "source_read", &result)?;
            }
            Ok(result)
        }
        "draft_hypothesis" => {
            let request: DraftHypothesis =
                serde_json::from_value(payload.clone()).map_err(|_| "invalid_hypothesis")?;
            let mut current = task(&db, &scope, &request.task_id)?;
            bounded(&request.question, 4000)?;
            bounded(&request.proposed_mechanism, 8000)?;
            bounded(&request.changed_assumption, 4000)?;
            if request.nearest_baselines.len() > 8
                || request.applicability_conditions.len() > 12
                || request.predictions.is_empty()
                || request.predictions.len() > 12
                || request.falsification_criteria.is_empty()
                || request.falsification_criteria.len() > 12
                || request.literature_refs.len() > 12
            {
                return Err("invalid_hypothesis_budget".into());
            }
            for values in [
                &request.nearest_baselines,
                &request.applicability_conditions,
                &request.predictions,
                &request.falsification_criteria,
            ] {
                for value in values {
                    bounded(value, 4000)?;
                }
            }
            let mut body = payload;
            body["status"] = json!("speculative");
            body["novelty"] = json!("not_assessed");
            let record = store_record(&db, &scope, "hypothesis", body)?;
            current["activeHypothesisRefs"]
                .as_array_mut()
                .ok_or("corrupt_task")?
                .push(json!({"id":record["id"],"hash":record["hash"]}));
            save_task(&db, &scope, &mut current)?;
            Ok(record)
        }
        "prepare_spec" => {
            let request: PrepareSpec =
                serde_json::from_value(payload).map_err(|_| "invalid_spec")?;
            let current = task(&db, &scope, &request.task_id)?;
            request.replay.validate()?;
            db.execute("INSERT OR IGNORE INTO research_code_snapshots(scope,sha256,source) VALUES(?1,?2,?3)",
                params![scope,research_runner::code_digest(),include_str!("research_runner.rs")]).map_err(|e|e.to_string())?;
            let hypothesis = record(&db, &scope, &request.hypothesis_id, "hypothesis")?;
            if hypothesis["body"]["taskId"] != request.task_id {
                return Err("hypothesis_task_mismatch".into());
            }
            let refs: Vec<SourceRef> =
                serde_json::from_value(hypothesis["body"]["literatureRefs"].clone())
                    .map_err(|_| "invalid_packet")?;
            validate_packet(&db, &scope, &request.task_id, &refs)?;
            let body = json!({"schema":"liteasy.experiment-spec/v1","taskId":request.task_id,"hypothesisRef":{"id":request.hypothesis_id,"hash":hypothesis["hash"]},
                "projectRef":current["projectRef"],"baseline":"lru","replay":request.replay,"editablePaths":[],
                "traceRevision":digest(&json!({"training":research_runner::trace(request.replay.samples,request.replay.train_seed,false),"heldout":research_runner::trace(request.replay.samples,request.replay.holdout_seed,true),"negative":research_runner::negative_trace(request.replay.samples,request.replay.holdout_seed)}))?,
                "environment":{"runner":"cpu_builtin","network":"disabled","arbitraryCode":"unsupported","hostOs":std::env::consts::OS,"hostArch":std::env::consts::ARCH,"appVersion":env!("CARGO_PKG_VERSION"),"cargoLockSha256":format!("{:x}",Sha256::digest(include_bytes!("../Cargo.lock")))},"holdoutPolicy":"independent_seeded_strided_workload","negativeControl":"seeded_unpredictable_access","ablation":"compute_us_zero_on_separate_workload",
                "resourceLimits":{"maxWallSeconds":10,"maxSamples":20000,"networkBytes":0,"editablePaths":[]},
                "metrics":["simulated_wait_p50_us","simulated_wait_p95_us","simulated_samples_per_second","read_amplification","cache_peak_bytes","replay_wall_us"],
                "correctnessChecks":["sample_identity","sample_order","multimodal_alignment","cache_byte_budget"],"literaturePacket":{"owner":"Liteasy_source_reference_index","semanticSupport":"not_assessed","spans":packet_spans(&db,&scope,&request.task_id,&refs)?},"sourceBindings":source_bindings(&db,&scope,&refs)?,"literatureRefs":refs});
            let spec = store_record(&db, &scope, "spec", body)?;
            store_record(
                &db,
                &scope,
                "hypothesis_assessment",
                json!({"taskId":request.task_id,"hypothesisRef":spec["body"]["hypothesisRef"],"status":"testable","specRef":{"id":spec["id"],"hash":spec["hash"]},"scientificSupport":"not_assessed","novelty":"not_assessed"}),
            )?;
            let mut current = current;
            current["taskBrief"]["hypotheses"] = current["activeHypothesisRefs"].clone();
            current["taskBrief"]["nextCheck"] =
                json!("检查并批准固定的小实验规格，或修改假设；此规格尚无实测结果。");
            save_task(&db, &scope, &mut current)?;
            Ok(spec)
        }
        "approve_small_experiment" => {
            let request: Approve =
                serde_json::from_value(payload).map_err(|_| "invalid_approval")?;
            let spec = record(&db, &scope, &request.spec_id, "spec")?;
            if spec["hash"] != request.expected_spec_hash
                || spec["body"]["taskId"] != request.task_id
            {
                return Err("approval_spec_mismatch".into());
            }
            let mut current = task(&db, &scope, &request.task_id)?;
            let epoch = crate::desktop_identity::authorization_epoch()?;
            let grant = store_record(
                &db,
                &scope,
                "grant",
                json!({"taskId":request.task_id,"specId":request.spec_id,"specHash":request.expected_spec_hash,
                "epoch":epoch,"bootId":boot_id(),"expiresAtUnix":Utc::now().timestamp()+900,"level":"project_small_experiment","network":false,"maxAttempts":1,
                "issuedBy":"local_user_confirmation","projectRef":current["projectRef"]}),
            )?;
            current["permissionGrantRef"] = json!({"id":grant["id"],"hash":grant["hash"]});
            current["taskBrief"]["permissionRef"] = current["permissionGrantRef"].clone();
            save_task(&db, &scope, &mut current)?;
            Ok(grant)
        }
        "submit" => {
            let request: Submit = serde_json::from_value(payload).map_err(|_| "invalid_submit")?;
            bounded(&request.idempotency_key, 160)?;
            // Serialize reconciliation with reserving the native worker so simultaneous
            // retries observe one persisted intent and cannot race its registration.
            let mut reservation = state.jobs.lock().map_err(|_| "host_unavailable")?;
            let prior:Option<String>=db.query_row("SELECT id FROM research_jobs WHERE scope=?1 AND task_id=?2 AND operation_key=?3",
                params![scope,request.task_id,request.idempotency_key],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
            if let Some(rid) = prior {
                let existing = job(&db, &scope, &rid)?;
                if existing["specId"] != request.spec_id {
                    return Err("idempotency_conflict".into());
                }
                return Ok(existing);
            }
            let spec = record(&db, &scope, &request.spec_id, "spec")?;
            let grant = record(&db, &scope, &request.grant_id, "grant")?;
            let epoch = crate::desktop_identity::authorization_epoch()?;
            if spec["body"]["taskId"] != request.task_id
                || grant["body"]["taskId"] != request.task_id
                || grant["body"]["specId"] != request.spec_id
                || grant["body"]["specHash"] != spec["hash"]
                || grant["body"]["epoch"].as_u64() != Some(epoch)
                || grant["body"]["bootId"] != boot_id()
                || grant["body"]["expiresAtUnix"].as_i64().unwrap_or(0) < Utc::now().timestamp()
            {
                return Err("permission_grant_invalid".into());
            }
            let used:i64=db.query_row("SELECT COUNT(*) FROM research_jobs WHERE scope=?1 AND json_extract(body,'$.grantId')=?2",params![scope,request.grant_id],|r|r.get(0)).map_err(|e|e.to_string())?;
            if used > 0 {
                return Err("grant_exhausted".into());
            }
            let mut current = task(&db, &scope, &request.task_id)?;
            if current["budget"]["usedRuns"].as_u64().unwrap_or(6) >= 6 {
                current["state"] = json!("exhausted");
                save_task(&db, &scope, &mut current)?;
                return Err("budget_exhausted".into());
            }
            let replay: ReplaySpec = serde_json::from_value(spec["body"]["replay"].clone())
                .map_err(|_| "invalid_spec")?;
            replay.validate()?;
            let refs: Vec<SourceRef> =
                serde_json::from_value(spec["body"]["literatureRefs"].clone())
                    .map_err(|_| "invalid_packet")?;
            validate_packet(&db, &scope, &request.task_id, &refs)?;
            if source_bindings(&db, &scope, &refs)? != spec["body"]["sourceBindings"] {
                return Err("literature_packet_tampered_or_changed".into());
            }
            let rid = id("run");
            let cancel = Arc::new(AtomicBool::new(false));

            let run = json!({"schema":"liteasy.experiment-run/v1","runId":rid,"taskId":request.task_id,"specId":request.spec_id,"specHash":spec["hash"],
                "attemptId":id("attempt"),"jobId":rid,"grantId":request.grant_id,"status":"submitting","startedAt":now(),"origin":"host_measured",
                "cost":{"externalCalls":0,"networkBytes":0},"validatorVersion":research_runner::VALIDATOR_VERSION});
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|e| e.to_string())?;
            let count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM research_jobs WHERE scope=?1 AND task_id=?2",
                    params![scope, request.task_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count >= 6 {
                current["state"] = json!("exhausted");
                save_task(&tx, &scope, &mut current)?;
                tx.commit().map_err(|e| e.to_string())?;
                return Err("budget_exhausted".into());
            }
            current = task(&tx, &scope, &request.task_id)?;
            if matches!(current["state"].as_str(), Some("running" | "waiting_job")) {
                return Err("task_execution_in_progress".into());
            }
            tx.execute("INSERT INTO research_jobs(scope,id,task_id,spec_id,operation_key,status,body) VALUES(?1,?2,?3,?4,?5,'submitting',?6)",
                params![scope,rid,request.task_id,request.spec_id,request.idempotency_key,run.to_string()]).map_err(|e|e.to_string())?;
            current["state"] = json!("waiting_job");
            current["budget"]["usedRuns"] =
                json!(current["budget"]["usedRuns"].as_u64().unwrap_or(0) + 1);
            current["backendRunRefs"]
                .as_array_mut()
                .ok_or("corrupt_task")?
                .push(json!({"runId":rid,"backend":"bounded_cpu_runner"}));
            save_task(&tx, &scope, &mut current)?;
            event(&tx, &scope, &request.task_id, "submit_intent", &run)?;
            tx.commit().map_err(|e| e.to_string())?;
            reservation.insert(rid.clone(), cancel.clone());
            drop(reservation);
            let host = app.clone();
            let worker_scope = scope.clone();
            let worker_rid = rid.clone();
            let grant_expiry = grant["body"]["expiresAtUnix"].as_i64().unwrap_or(0);
            std::thread::spawn(move || {
                let started = std::time::Instant::now();
                let outcome = (|| -> Result<Value, String> {
                    let mut value = job(&db, &worker_scope, &worker_rid)?;
                    value["status"] = json!("running");
                    update_job(&db, &worker_scope, &value)?;
                    let result = research_runner::run(&replay, &cancel, || {
                        crate::desktop_identity::local_object_scope().as_deref()
                            == Ok(worker_scope.as_str())
                            && crate::desktop_identity::authorization_epoch() == Ok(epoch)
                            && Utc::now().timestamp() <= grant_expiry
                    })?;
                    let value = serde_json::to_value(result).map_err(|_| "invalid_output")?;
                    Ok(value)
                })();
                // A revoked scope must not force an output into the new account. The old job is
                // reconciled as interrupted when its original account next queries it.
                if let Ok(result) = finalize_timed(
                    &db,
                    &worker_scope,
                    &worker_rid,
                    outcome,
                    Some(started.elapsed().as_micros() as u64),
                ) {
                    let _ = host.emit(
                        "liteasy-research-event",
                        json!({"scope":worker_scope,"run":result}),
                    );
                }
                use tauri::Manager;
                if let Some(state) = host.try_state::<ResearchHostState>() {
                    if let Ok(mut jobs) = state.jobs.lock() {
                        jobs.remove(&worker_rid);
                    }
                }
            });
            Ok(run)
        }
        "approve_external_model" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct External {
                task_id: String,
                account_id: String,
                model: String,
                source_refs: Vec<SourceRef>,
            }
            let request: External =
                serde_json::from_value(payload).map_err(|_| "invalid_outbound_grant")?;
            task(&db, &scope, &request.task_id)?;
            bounded(&request.account_id, 128)?;
            bounded(&request.model, 128)?;
            if request.source_refs.len() > 12 {
                return Err("source_budget_exceeded".into());
            }
            for reference in &request.source_refs {
                source(&db, &scope, reference)?;
            }
            store_record(
                &db,
                &scope,
                "outbound_grant",
                json!({"taskId":request.task_id,"accountId":request.account_id,"model":request.model,
                "sourceBindings":source_bindings(&db,&scope,&request.source_refs)?,"sourceRefs":request.source_refs,"epoch":crate::desktop_identity::authorization_epoch()?,"bootId":boot_id(),"planEpoch":app.state::<crate::chatgpt_plan::ChatgptPlanState>().epoch.load(Ordering::SeqCst),
                "expiresAtUnix":Utc::now().timestamp()+900,"maxToolCalls":24,"allowedDestination":"https://api.openai.com/v1","issuedBy":"local_user_confirmation"}),
            )
        }
        "record_source_delivery" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Delivery {
                task_id: String,
                reference: SourceRef,
                offset: usize,
                text: String,
            }
            let request: Delivery =
                serde_json::from_value(payload).map_err(|_| "invalid_delivery")?;
            task(&db, &scope, &request.task_id)?;
            let actual = source(&db, &scope, &request.reference)?;
            let full = text(&actual)?;
            let encoded: Vec<u16> = full.encode_utf16().collect();
            let selected: Vec<u16> = request.text.encode_utf16().collect();
            if selected.is_empty()
                || selected.len() > 12000
                || request.offset + selected.len() > encoded.len()
                || encoded[request.offset..request.offset + selected.len()] != selected
            {
                return Err("source_delivery_mismatch".into());
            }
            let result = json!({"reference":request.reference,"sourceHash":digest(&actual)?,"offset":request.offset,"endOffset":request.offset+selected.len(),"offsetUnit":"utf16","characters":selected.len(),
                "unit":"utf16","payloadHash":format!("{:x}",Sha256::digest(request.text.as_bytes())),"coverage":"bounded_excerpt","semanticSupport":"not_verified"});
            event(&db, &scope, &request.task_id, "source_read", &result)?;
            Ok(result)
        }
        "get_run" => {
            let q: RunQuery = serde_json::from_value(payload).map_err(|_| "invalid_query")?;
            let value = job(&db, &scope, &q.run_id)?;
            if matches!(value["status"].as_str(), Some("running" | "submitting"))
                && !state
                    .jobs
                    .lock()
                    .map_err(|_| "host_unavailable")?
                    .contains_key(&q.run_id)
            {
                return finalize(
                    &db,
                    &scope,
                    &q.run_id,
                    Err("host_restarted: reconcile; never resubmit automatically".into()),
                );
            }
            if value["status"] == "completed" && digest(&value["rawResult"])? != value["resultHash"]
            {
                return Err("measured_result_tampered".into());
            }
            Ok(value)
        }
        "cancel" => {
            let q: RunQuery = serde_json::from_value(payload).map_err(|_| "invalid_query")?;
            let value = job(&db, &scope, &q.run_id)?;
            if let Some(cancel) = state
                .jobs
                .lock()
                .map_err(|_| "host_unavailable")?
                .get(&q.run_id)
            {
                cancel.store(true, Ordering::Relaxed);
            }
            Ok(value)
        }
        "decision" => record_decision(
            &db,
            &scope,
            serde_json::from_value(payload).map_err(|_| "invalid_decision")?,
        ),
        "confirm_claim" => {
            let request: HumanConfirmation =
                serde_json::from_value(payload).map_err(|_| "invalid_confirmation")?;
            let claim = record(&db, &scope, &request.claim_id, "claim")?;
            if claim["hash"] != request.expected_claim_hash
                || claim["body"]["taskId"] != request.task_id
            {
                return Err("claim_confirmation_mismatch".into());
            }
            store_record(
                &db,
                &scope,
                "review",
                json!({"taskId":request.task_id,"claimRef":{"id":request.claim_id,"hash":request.expected_claim_hash},"humanConfirmation":"acknowledged","semanticSupport":"human_judgment_not_independent_proof"}),
            )
        }
        _ => Err("research_operation_unavailable".into()),
    }
}

pub fn cli_replay(args: &[String]) -> Option<i32> {
    if args.first().map(String::as_str) != Some("--research-replay") {
        return None;
    }
    let result = (|| -> Result<(), String> {
        if args.len() != 5 || args[1] != "--spec" || args[3] != "--output" {
            return Err("usage: --research-replay --spec spec.json --output new-directory".into());
        }
        let bytes = std::fs::read(&args[2]).map_err(|_| "spec_read_failed")?;
        if bytes.len() > 64 * 1024 {
            return Err("spec_too_large".into());
        }
        let spec: ReplaySpec = serde_json::from_slice(&bytes).map_err(|_| "invalid_spec")?;
        let result = research_runner::run(&spec, &AtomicBool::new(false), || true)?;
        let target = std::path::Path::new(&args[4]);
        std::fs::create_dir(target).map_err(|_| "output_must_be_new_directory")?;
        std::fs::write(
            target.join("spec.json"),
            serde_json::to_vec_pretty(&spec).map_err(|_| "invalid_spec")?,
        )
        .map_err(|_| "output_failed")?;
        let value = json!({"origin":"unregistered_cpu_replay","result":result});
        std::fs::write(
            target.join("raw-result.json"),
            serde_json::to_vec_pretty(&value).map_err(|_| "invalid_output")?,
        )
        .map_err(|_| "output_failed")?;
        println!(
            "{}",
            json!({"ok":true,"origin":"unregistered_cpu_replay","correctnessPassed":value["result"]["correctnessPassed"]})
        );
        Ok(())
    })();
    Some(match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{}", json!({"ok":false,"error":error}));
            2
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        db
    }
    fn create_test_task(db: &Connection) {
        let task = json!({"taskId":"task","state":"waiting_user","checkpointRevision":1,"backendRunRefs":[],"budget":{"usedRuns":1},"taskBrief":{"facts":[],"failedExperiments":[]}});
        db.execute(
            "INSERT INTO research_tasks VALUES('a','task',?1)",
            params![task.to_string()],
        )
        .unwrap();
    }
    fn measured_run(db: &Connection) -> Value {
        create_test_task(db);
        let replay = research_runner::tests::spec();
        let spec = store_record(db, "a", "spec", json!({"taskId":"task","replay":replay,"hypothesisRef":{"id":"hypothesis","hash":"fixed"}})).unwrap();
        let result = serde_json::to_value(
            research_runner::run(&replay, &AtomicBool::new(false), || true).unwrap(),
        )
        .unwrap();
        let run = json!({"runId":"run","taskId":"task","status":"completed","origin":"host_measured",
            "specId":spec["id"],"specHash":spec["hash"],"rawResult":result,"resultHash":digest(&result).unwrap()});
        db.execute(
            "INSERT INTO research_jobs VALUES('a','run','task',?1,'operation','completed',?2)",
            params![spec["id"].as_str(), run.to_string()],
        )
        .unwrap();
        run
    }
    fn decision(action: &str) -> Decision {
        Decision {
            task_id: "task".into(),
            run_id: "run".into(),
            action: action.into(),
            rationale: "保留条件，检查反例。".into(),
        }
    }
    #[test]
    fn tampered_measurement_cannot_leave_even_a_partial_decision() {
        let db = db();
        let mut run = measured_run(&db);
        run["rawResult"]["correctnessPassed"] = json!(false);
        update_job(&db, "a", &run).unwrap();
        assert!(record_decision(&db, "a", decision("narrow")).is_err());
        assert!(records(&db, "a", "task")
            .unwrap()
            .iter()
            .all(|r| r["kind"] != "decision" && r["kind"] != "claim"));
        assert_eq!(task(&db, "a", "task").unwrap()["state"], "waiting_user");
    }
    #[test]
    fn failed_experiment_can_deliver_a_stop_decision_without_upgrading_a_claim() {
        let db = db();
        let mut run = measured_run(&db);
        run["status"] = json!("failed");
        run["error"] = json!("runner_failed");
        update_job(&db, "a", &run).unwrap();
        assert!(record_decision(&db, "a", decision("narrow")).is_err());
        let stopped = record_decision(&db, "a", decision("stop")).unwrap();
        assert!(stopped["claim"].is_null());
        assert_eq!(task(&db, "a", "task").unwrap()["state"], "completed");
        record_decision(&db, "a", decision("reopen")).unwrap();
        assert_eq!(task(&db, "a", "task").unwrap()["state"], "waiting_user");
        assert_eq!(job(&db, "a", "run").unwrap()["status"], "failed");
    }
    #[test]
    fn reassessment_appends_versions_and_continuing_does_not_claim_delivery() {
        let db = db();
        measured_run(&db);
        let first = record_decision(&db, "a", decision("narrow")).unwrap();
        let second = record_decision(&db, "a", decision("continue")).unwrap();
        let values = records(&db, "a", "task").unwrap();
        assert_eq!(values.last().unwrap()["id"], second["claim"]["id"]);
        assert_eq!(
            record(&db, "a", first["claim"]["id"].as_str().unwrap(), "claim").unwrap(),
            first["claim"]
        );
        assert_eq!(task(&db, "a", "task").unwrap()["state"], "waiting_user");
        assert!(!task(&db, "a", "task").unwrap()["taskBrief"]["nextCheck"]
            .as_str()
            .unwrap()
            .contains("已交付"));
    }
    #[test]
    fn interrupted_inference_keeps_a_resumable_thread_without_claiming_completion() {
        let db = db();
        create_test_task(&db);
        begin_backend(&db, "a", "task", "grant", "worker", "agent-run").unwrap();
        let grant = json!({"body":{"accountId":"account","model":"model","sourceRefs":[]}});
        checkpoint_backend(&db, "a", "task", "worker", "thread", &grant).unwrap();
        checkpoint_backend(&db, "a", "task", "worker", "thread", &grant).unwrap();
        finish_backend(
            &db,
            "a",
            "task",
            "worker",
            "interrupted",
            &json!({"usage":null}),
        )
        .unwrap();
        let checkpoints: Vec<_> = records(&db, "a", "task")
            .unwrap()
            .into_iter()
            .filter(|r| r["kind"] == "backend_checkpoint")
            .collect();
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0]["body"]["status"], "resumable_thread");
        assert_eq!(task(&db, "a", "task").unwrap()["state"], "interrupted");
    }
    #[test]
    fn one_outbound_grant_cannot_launch_two_model_turns() {
        let db = db();
        create_test_task(&db);
        begin_backend(&db, "a", "task", "grant", "worker", "agent-run").unwrap();
        assert!(begin_backend(&db, "a", "task", "grant", "second-worker", "second-run").is_err());
        assert_eq!(task(&db, "a", "task").unwrap()["state"], "running");
        finish_backend(
            &db,
            "a",
            "task",
            "worker",
            "completed",
            &json!({"usage":null}),
        )
        .unwrap();
        assert_eq!(task(&db, "a", "task").unwrap()["state"], "waiting_user");
        assert_eq!(
            task(&db, "a", "task").unwrap()["backendRunRefs"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn restart_cancel_and_budget_exhaustion_are_distinct_terminal_states() {
        for (reason, status, task_state) in [
            ("host_restarted: reconcile", "interrupted", "interrupted"),
            ("cancelled", "cancelled", "interrupted"),
            ("exhausted", "exhausted", "exhausted"),
        ] {
            let db = db();
            create_test_task(&db);
            let run = json!({"runId":"run","taskId":"task","status":"running","specId":"spec"});
            db.execute("INSERT INTO research_jobs VALUES('a','run','task','spec','operation','running',?1)",params![run.to_string()]).unwrap();
            assert_eq!(
                finalize(&db, "a", "run", Err(reason.into())).unwrap()["status"],
                status
            );
            assert_eq!(task(&db, "a", "task").unwrap()["state"], task_state);
            assert_eq!(
                task(&db, "a", "task").unwrap()["taskBrief"]["failedExperiments"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
        }
    }
    #[test]
    fn source_versions_and_actual_read_spans_remain_bound_to_the_spec() {
        let db = db();
        db.execute(
            "CREATE TABLE object_records(scope TEXT,key TEXT,value TEXT)",
            [],
        )
        .unwrap();
        let original = json!({"objectId":"source","revision":"v1","scopeId":"a","kind":"content.note","content":{"payload":{"text":"original"}}});
        db.execute(
            "INSERT INTO object_records VALUES('a','revision/source/v1',?1)",
            params![original.to_string()],
        )
        .unwrap();
        let refs = vec![SourceRef {
            object_id: "source".into(),
            revision: "v1".into(),
        }];
        assert!(validate_packet(&db, "a", "task", &refs).is_err());
        event(&db,"a","task","source_read",&json!({"ref":refs[0],"sourceHash":digest(&original).unwrap(),"offset":0,"endOffset":8,"offsetUnit":"unicode_scalars"})).unwrap();
        validate_packet(&db, "a", "task", &refs).unwrap();
        let pinned = source_bindings(&db, "a", &refs).unwrap();
        assert_eq!(read_spans(&db, "a", "task").unwrap()[0]["endOffset"], 8);
        event(&db,"a","task","source_read",&json!({"ref":{"objectId":"private-other-source","revision":"v1"},"sourceHash":"unrelated","offset":0,"endOffset":10})).unwrap();
        let packet = packet_spans(&db, "a", "task", &refs).unwrap();
        assert_eq!(packet.len(), 1);
        assert_eq!(packet[0]["reference"]["objectId"], "source");
        let mut changed = original;
        changed["content"]["payload"]["text"] = json!("tampered");
        db.execute(
            "UPDATE object_records SET value=?1",
            params![changed.to_string()],
        )
        .unwrap();
        assert_ne!(source_bindings(&db, "a", &refs).unwrap(), pinned);
        assert!(validate_packet(&db, "a", "task", &refs).is_err());
    }
    #[test]
    fn authoritative_records_are_immutable_and_scope_partitioned() {
        let db = db();
        let r = store_record(
            &db,
            "a",
            "hypothesis",
            json!({"taskId":"t","status":"speculative"}),
        )
        .unwrap();
        assert!(record(&db, "b", r["id"].as_str().unwrap(), "hypothesis").is_err());
        assert!(record(&db, "a", "model-invented-run", "run").is_err());
        assert_eq!(
            record(&db, "a", r["id"].as_str().unwrap(), "hypothesis").unwrap()["body"]["status"],
            "speculative"
        );
        db.execute("UPDATE research_records SET body='{}' WHERE scope='a'", [])
            .unwrap();
        assert!(record(&db, "a", r["id"].as_str().unwrap(), "hypothesis").is_err());
    }
    #[test]
    fn persistent_operation_keys_reconcile_lost_receipts_instead_of_repeating() {
        let db = db();
        db.execute("INSERT INTO research_jobs VALUES('a','host-run','t','spec','operation-1','submitting','{}')",[]).unwrap();
        assert!(db.execute("INSERT INTO research_jobs VALUES('a','different-run','t','spec','operation-1','running','{}')",[]).is_err());
        let rid:String=db.query_row("SELECT id FROM research_jobs WHERE scope='a' AND task_id='t' AND operation_key='operation-1'",[],|r|r.get(0)).unwrap();
        assert_eq!(rid, "host-run");
    }
}
