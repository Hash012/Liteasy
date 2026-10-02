//! Bounded read-only commands over the same grants and snapshots as the desktop.
//! This branch returns before constructing Tauri; the existing agent CLI is unchanged.
use crate::note_files::store::{validate_path, FileStore};
use serde_json::{json, Value};
use std::{ffi::OsString, io::Write, path::PathBuf};

const SCHEMA: &str = "liteasy.local-files-cli/v1";
struct Failure {
    exit: i32,
    code: &'static str,
    message: String,
}
impl Failure {
    fn new(exit: i32, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            exit,
            code,
            message: message.into(),
        }
    }
}
enum Command {
    Mounts,
    List(String),
    Extract {
        grant: String,
        path: String,
        expected: Option<String>,
    },
}
fn usage() -> Failure {
    Failure::new(2, "invalid_arguments", "Usage: --agent-cli local-files mounts|list <grant-id>|extract <grant-id> <relative-path> [--expected-revision <sha256>] [--json]. Only saved local grants and read-only commands are supported.")
}
fn parse(args: &[OsString]) -> Result<Command, Failure> {
    if args.len() > 8 {
        return Err(usage());
    }
    let mut positionals = Vec::new();
    let mut expected = None;
    let mut json_seen = false;
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].to_str().ok_or_else(usage)?;
        if arg.len() > 8192 || arg.chars().any(char::is_control) {
            return Err(usage());
        }
        match arg {
            "--json" if !json_seen => json_seen = true,
            "--expected-revision" if expected.is_none() => {
                i += 1;
                let value = args.get(i).and_then(|s| s.to_str()).ok_or_else(usage)?;
                if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
                    return Err(usage());
                }
                expected = Some(value.to_ascii_lowercase());
            }
            value if !value.starts_with('-') => positionals.push(value),
            _ => return Err(usage()),
        }
        i += 1;
    }
    let valid_grant = |id: &str| {
        id.len() <= 128
            && !id.is_empty()
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    match positionals.as_slice() {
        ["mounts"] if expected.is_none() => Ok(Command::Mounts),
        ["list", grant] if expected.is_none() && valid_grant(grant) => {
            Ok(Command::List((*grant).into()))
        }
        ["extract", grant, path] if valid_grant(grant) => {
            validate_path(path, true).map_err(|_| usage())?;
            Ok(Command::Extract {
                grant: (*grant).into(),
                path: (*path).into(),
                expected,
            })
        }
        _ => Err(usage()),
    }
}
fn execute(command: Command, root: PathBuf) -> Result<Value, Failure> {
    let files = FileStore::open_read_only(&root, "local")
        .map_err(|error| Failure::new(3, "store_unavailable", error))?;
    let mounts = files
        .mounts()
        .map_err(|error| Failure::new(3, "store_unavailable", error))?;
    let authorize = |grant: &str| {
        if mounts.iter().any(|m| m.id == grant) {
            Ok(())
        } else {
            Err(Failure::new(
                4,
                "grant_unavailable",
                "Grant is not authorized in the local scope. Select it in the desktop first.",
            ))
        }
    };
    match command {
        Command::Mounts => Ok(json!({"command":"mounts", "mounts": mounts})),
        Command::List(grant) => {
            authorize(&grant)?;
            let entries = files
                .entries(&grant)
                .map_err(|error| Failure::new(6, "read_failed", error))?;
            Ok(json!({"command":"list", "grantId": grant, "entries": entries, "truncated": false}))
        }
        Command::Extract {
            grant,
            path,
            expected,
        } => {
            authorize(&grant)?;
            let snapshot = files
                .read(&grant, &path)
                .map_err(|error| Failure::new(6, "read_failed", error))?;
            if expected
                .as_ref()
                .is_some_and(|value| snapshot.version.as_ref() != Some(value))
            {
                return Err(Failure::new(5, "revision_conflict", "File revision changed; no content was emitted. Read the current revision before retrying."));
            }
            let format = if path.to_ascii_lowercase().ends_with(".canvas") {
                "canvas"
            } else {
                "markdown"
            };
            Ok(
                json!({"command":"extract", "format":format, "bytes":snapshot.text.len(),
                "truncated":false, "revision":snapshot.version, "snapshot":snapshot}),
            )
        }
    }
}

/// Args start after `--agent-cli local-files`. The scope callback must return the
/// effective native scope, including an archived recovery profile's fixed scope.
pub fn run(
    args: &[OsString],
    root: impl FnOnce() -> Result<PathBuf, String>,
    scope: impl FnOnce() -> Result<String, String>,
    stdout: &mut impl Write,
    stderr: &mut impl Write,
) -> i32 {
    let result = (|| {
        let command = parse(args)?;
        if scope().map_err(|error| Failure::new(4, "scope_unavailable", error))? != "local" {
            return Err(Failure::new(4, "scope_unavailable", "Headless file commands support only the local scope; account and recovered account scopes require the desktop."));
        }
        execute(
            command,
            root().map_err(|error| Failure::new(3, "store_unavailable", error))?,
        )
    })();
    match result {
        Ok(result) => {
            if writeln!(
                stdout,
                "{}",
                json!({"schema":SCHEMA, "ok":true, "scope":"local", "result":result})
            )
            .is_ok()
            {
                0
            } else {
                7
            }
        }
        Err(error) => {
            let _ = writeln!(
                stderr,
                "{}",
                json!({"schema":SCHEMA, "ok":false, "error":{"code":error.code, "message":error.message}})
            );
            error.exit
        }
    }
}

pub fn run_external_mode(
    root: impl FnOnce() -> Result<PathBuf, String>,
    scope: impl FnOnce() -> Result<String, String>,
) -> Option<i32> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.first().is_none_or(|s| s != "--agent-cli")
        || args.get(1).is_none_or(|s| s != "local-files")
    {
        return None;
    }
    Some(run(
        &args[2..],
        root,
        scope,
        &mut std::io::stdout().lock(),
        &mut std::io::stderr().lock(),
    ))
}
