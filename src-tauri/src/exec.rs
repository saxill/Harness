//! Runs a command on any device and streams its output to the UI.
//!
//! Local device: a login shell. Unix remotes: `ssh host bash -lc '<cmd>'` so
//! PATH matches an interactive login. Windows: PowerShell with the command
//! base64-encoded, which is the only quoting that survives cmd.exe + ssh.
//! Every run is appended to history.jsonl, including who asked for it.
use crate::{devices, devices::Device, AppState};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    process::Stdio,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::oneshot,
};

const SSH: &str = "/usr/bin/ssh";
const MAX_LINE: usize = 4000;

pub fn encode_powershell(script: &str) -> String {
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
}

fn single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// A ready-to-spawn process for `command` on `dev`.
pub fn build(dev: &Device, command: &str) -> Command {
    if dev.is_local {
        let shell = if cfg!(target_os = "macos") { "/bin/zsh" } else { "/bin/bash" };
        let mut c = Command::new(shell);
        c.arg("-lc").arg(command);
        return c;
    }
    let mut c = Command::new(SSH);
    c.args([
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=8",
        "-o", "ServerAliveInterval=15",
        "-o", "StrictHostKeyChecking=accept-new",
        &dev.host,
    ]);
    if dev.kind == "windows" {
        c.arg(format!(
            "powershell -NoProfile -NonInteractive -EncodedCommand {}",
            encode_powershell(&format!("$ProgressPreference='SilentlyContinue'; {command}"))
        ));
    } else {
        c.arg(format!("bash -lc {}", single_quote(command)));
    }
    c
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    run_id: String,
    stream: &'static str,
    line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    run_id: String,
    code: Option<i32>,
    cancelled: bool,
    duration_ms: u128,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn history_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("history.jsonl"))
}

fn append_history(app: &AppHandle, entry: Value) {
    if let Some(path) = history_path(app) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{entry}");
        }
    }
}

#[tauri::command]
pub async fn run_start(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
    device_id: String,
    command: String,
    source: String,
) -> Result<(), String> {
    let dev = devices::find(&app, &device_id)?;
    let mut proc = build(&dev, &command);
    proc.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = proc.spawn().map_err(|e| format!("could not start: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.runs.lock().await.insert(run_id.clone(), cancel_tx);

    let pump = |reader: Box<dyn tokio::io::AsyncRead + Unpin + Send>, stream: &'static str| {
        let app = app.clone();
        let run_id = run_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(mut line)) = lines.next_line().await {
                if line.len() > MAX_LINE {
                    line.truncate(MAX_LINE);
                    line.push_str(" …");
                }
                let _ = app.emit("run://output", OutputEvent { run_id: run_id.clone(), stream, line });
            }
        })
    };
    let out_task = pump(Box::new(stdout), "stdout");
    let err_task = pump(Box::new(stderr), "stderr");

    let app2 = app.clone();
    tokio::spawn(async move {
        let started = Instant::now();
        let (code, cancelled) = tokio::select! {
            status = child.wait() => (status.ok().and_then(|s| s.code()), false),
            _ = cancel_rx => {
                // Only ever the child we spawned, by handle — never by name.
                let _ = child.kill().await;
                (None, true)
            }
        };
        let _ = out_task.await;
        let _ = err_task.await;
        app2.state::<AppState>().runs.lock().await.remove(&run_id);
        let duration_ms = started.elapsed().as_millis();
        let _ = app2.emit(
            "run://exit",
            ExitEvent { run_id: run_id.clone(), code, cancelled, duration_ms },
        );
        append_history(
            &app2,
            json!({
                "ts": now_secs(), "runId": run_id, "deviceId": dev.id, "deviceName": dev.name,
                "command": command, "source": source, "code": code,
                "cancelled": cancelled, "durationMs": duration_ms as u64,
            }),
        );
    });
    Ok(())
}

#[tauri::command]
pub async fn run_cancel(state: State<'_, AppState>, run_id: String) -> Result<bool, String> {
    Ok(match state.runs.lock().await.remove(&run_id) {
        Some(tx) => tx.send(()).is_ok(),
        None => false,
    })
}

#[tauri::command]
pub fn history_list(app: AppHandle, limit: Option<usize>) -> Vec<Value> {
    let Some(path) = history_path(&app) else { return vec![] };
    let text = fs::read_to_string(path).unwrap_or_default();
    let mut rows: Vec<Value> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    rows.reverse();
    rows.truncate(limit.unwrap_or(300));
    rows
}

/// Run to completion and capture everything (probes and one-shot reads).
pub async fn capture(dev: &Device, command: &str, stdin: Option<&str>, timeout_s: u64) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;
    let mut proc = build(dev, command);
    proc.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    proc.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });
    let mut child = proc.spawn().map_err(|e| format!("could not start: {e}"))?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(input.as_bytes()).await.map_err(|e| e.to_string())?;
        drop(pipe);
    }
    let out = tokio::time::timeout(std::time::Duration::from_secs(timeout_s), child.wait_with_output())
        .await
        .map_err(|_| format!("timed out after {timeout_s}s"))?
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.status.success() && stdout.trim().is_empty() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("failed").trim().to_string());
    }
    Ok(stdout)
}
