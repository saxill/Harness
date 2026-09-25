//! Chat with Hermes and Zara from a real chat panel instead of their terminal
//! programs. Each message is one non-interactive turn:
//!   Hermes: `hermes chat --query-file … --oneshot -Q --format stream-json`,
//!           resuming the Harness session so the conversation carries on.
//!   Zara:   scripts/zara_ask.py piped to her venv on the Pi (her gateway,
//!           Sahil's chat id, so it continues the Telegram conversation).
//! Their JSON lines stream back as `chat://line`; `chat://done` ends the turn.
//! A turn is cancelled with `run_cancel(turn_id)`, like any other run.
use crate::{devices, exec, AppState};
use base64::Engine;
use serde::Serialize;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::oneshot,
};

const ZARA_ASK: &str = include_str!("scripts/zara_ask.py");

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatLine {
    turn_id: String,
    line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatDone {
    turn_id: String,
    code: Option<i32>,
    cancelled: bool,
    /// Last few stderr lines, only for explaining a failed turn.
    stderr: Vec<String>,
}

fn hermes_script(message_b64: &str, session: Option<&str>) -> String {
    // Session ids look like 20260926_023210_225d8b; anything else is dropped.
    let resume = session
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .map(|s| format!(" --resume {s}"))
        .unwrap_or_default();
    format!(
        r#"$env:HERMES_HOME='D:\hermes'; $env:PYTHONIOENCODING='utf-8'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$q = Join-Path $env:TEMP ('harness-chat-' + [guid]::NewGuid().ToString() + '.txt')
[IO.File]::WriteAllText($q, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{message_b64}')), (New-Object Text.UTF8Encoding $false))
try {{
  & 'D:\hermes\bin\hermes.exe' chat --query-file $q --oneshot -Q --format stream-json --source harness{resume} 2>&1 | ForEach-Object {{ "$_" }}
}} finally {{ Remove-Item $q -ErrorAction SilentlyContinue }}"#
    )
}

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    turn_id: String,
    agent: String,
    message: String,
    session: Option<String>,
) -> Result<(), String> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(message.as_bytes());
    let (dev, command, stdin) = match agent.as_str() {
        "hermes" => (devices::find(&app, "channa")?, hermes_script(&b64, session.as_deref()), None),
        "zara" => (
            devices::find(&app, "pi")?,
            "cd /mnt/phone_files/files && set -a && . ./.agent_env && set +a && exec .venv/bin/python -".to_string(),
            Some(format!("MESSAGE = '{b64}'\n{ZARA_ASK}")),
        ),
        other => return Err(format!("unknown agent {other}")),
    };

    let mut proc = exec::build(&dev, &command);
    proc.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = proc.spawn().map_err(|e| format!("could not start: {e}"))?;
    if let Some(input) = stdin {
        let mut w = child.stdin.take().ok_or("no stdin")?;
        w.write_all(input.as_bytes()).await.map_err(|e| e.to_string())?;
        drop(w);
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    // The message itself stays out of the history file.
    exec::log_session(&app, &dev, &format!("chat with {agent} (from Harness)"), "chat");

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.runs.lock().await.insert(turn_id.clone(), cancel_tx);

    let app_out = app.clone();
    let id_out = turn_id.clone();
    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit("chat://line", ChatLine { turn_id: id_out.clone(), line });
        }
    });
    let err_task = tokio::spawn(async move {
        let mut tail: Vec<String> = vec![];
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.contains("Ignoring invalid environment assignment") {
                continue;
            }
            tail.push(line.chars().take(300).collect());
            if tail.len() > 6 {
                tail.remove(0);
            }
        }
        tail
    });

    tokio::spawn(async move {
        let (code, cancelled) = tokio::select! {
            status = child.wait() => (status.ok().and_then(|s| s.code()), false),
            _ = cancel_rx => {
                // Only the child we spawned, by handle.
                let _ = child.kill().await;
                (None, true)
            }
        };
        let _ = out_task.await;
        let stderr = err_task.await.unwrap_or_default();
        app.state::<AppState>().runs.lock().await.remove(&turn_id);
        let _ = app.emit("chat://done", ChatDone { turn_id, code, cancelled, stderr });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hermes_script_drops_bad_session_ids() {
        assert!(hermes_script("aGk=", Some("20260926_023210_225d8b")).contains("--resume 20260926_023210_225d8b"));
        assert!(!hermes_script("aGk=", Some("x; Remove-Item C:\\")).contains("--resume"));
        assert!(!hermes_script("aGk=", None).contains("--resume"));
    }
}
