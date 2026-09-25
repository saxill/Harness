//! Real interactive terminals: a PTY per session, bridged to xterm.js in the
//! UI. Used for Claude Code, Hermes chat, Zara's CLI and plain shells on any
//! machine. Output travels base64-encoded so multi-byte characters split
//! across reads survive intact.
use crate::devices;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

#[derive(Default)]
pub struct Ptys(pub Mutex<HashMap<String, PtySession>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DataEvent {
    session_id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    session_id: String,
    code: Option<u32>,
}

fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn builder(dev: &devices::Device, command: Option<&str>, cwd: Option<&str>) -> CommandBuilder {
    let unix_script = |shell: &str| {
        let mut parts = vec![];
        if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
            parts.push(format!("cd {} 2>/dev/null || cd {}", dir.replace(' ', "\\ "), quote(dir)));
        }
        match command {
            // Drop into a shell afterwards so the pane doesn't vanish on exit.
            Some(c) => parts.push(format!("{c}; exec {shell} -l")),
            None => parts.push(format!("exec {shell} -l")),
        }
        parts.join("; ")
    };

    let mut cmd = if dev.is_local {
        let shell = if cfg!(target_os = "macos") { "/bin/zsh" } else { "/bin/bash" };
        let mut c = CommandBuilder::new(shell);
        c.args(["-lc", &unix_script(shell)]);
        c
    } else {
        let mut c = CommandBuilder::new("/usr/bin/ssh");
        c.args([
            "-tt", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15",
            "-o", "StrictHostKeyChecking=accept-new", &dev.host,
        ]);
        if dev.kind == "windows" {
            let mut ps = String::new();
            if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
                ps.push_str(&format!("Set-Location '{}'; ", dir.replace('\'', "''")));
            }
            if let Some(cm) = command {
                ps.push_str(cm);
            }
            c.arg(format!(
                "powershell -NoLogo -NoExit -EncodedCommand {}",
                crate::exec::encode_powershell(&ps)
            ));
        } else {
            c.arg(format!("bash -lc {}", quote(&unix_script("bash"))));
        }
        c
    };
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", "en_US.UTF-8");
    if let Some(home) = std::env::var_os("HOME") {
        cmd.cwd(home);
    }
    cmd
}

#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    session_id: String,
    device_id: String,
    command: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let dev = devices::find(&app, &device_id)?;
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let child = pair
        .slave
        .spawn_command(builder(&dev, command.as_deref(), cwd.as_deref()))
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let child = Arc::new(Mutex::new(child));

    ptys.0.lock().unwrap().insert(
        session_id.clone(),
        PtySession { master: pair.master, writer, child: child.clone() },
    );
    crate::exec::log_session(&app, &dev, command.as_deref().unwrap_or("(shell)"), "terminal");

    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app2.emit("pty://data", DataEvent { session_id: session_id.clone(), data });
                }
            }
        }
        let code = child.lock().ok().and_then(|mut c| c.wait().ok()).map(|s| s.exit_code());
        let _ = app2.emit("pty://exit", ExitEvent { session_id, code });
    });
    Ok(())
}

#[tauri::command]
pub fn pty_write(ptys: State<'_, Ptys>, session_id: String, data: String) -> Result<(), String> {
    let mut map = ptys.0.lock().unwrap();
    let s = map.get_mut(&session_id).ok_or("no such session")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(ptys: State<'_, Ptys>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = ptys.0.lock().unwrap();
    let s = map.get(&session_id).ok_or("no such session")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

/// Ends a session by killing its own child process — never by name.
#[tauri::command]
pub fn pty_close(ptys: State<'_, Ptys>, session_id: String) -> Result<(), String> {
    if let Some(s) = ptys.0.lock().unwrap().remove(&session_id) {
        if let Ok(mut c) = s.child.lock() {
            let _ = c.kill();
        }
    }
    Ok(())
}
