//! YouTube analytics (run on the Pi), the Laya judge (run on the laptop, where
//! its key lives) and the Obsidian vault (read/write one note at a time).
use crate::{devices, exec};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use tauri::{AppHandle, Manager};

const YOUTUBE: &str = include_str!("scripts/youtube.py");
const LAYA: &str = include_str!("scripts/laya.py");
const VAULT: &str = include_str!("scripts/vault.py");

fn b64(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

fn parse(text: &str) -> Result<Value, String> {
    let start = text.find('{').ok_or_else(|| format!("no JSON: {}", text.chars().take(200).collect::<String>()))?;
    let end = text.rfind('}').ok_or("no JSON")?;
    serde_json::from_str(&text[start..=end]).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn youtube_stats(app: AppHandle, channels: Vec<String>) -> Result<Value, String> {
    let dev = devices::load(&app).into_iter().find(|d| d.pipelines).ok_or("no pipelines machine")?;
    let ok = regex::Regex::new(r"^@?[\w.\-]{2,60}$").unwrap();
    let handles: Vec<String> = channels.into_iter().filter(|c| ok.is_match(c)).collect();
    let text = exec::capture(&dev, &format!("python3 - {}", handles.join(" ")), Some(YOUTUBE), 240).await?;
    parse(&text)
}

/// One Laya call: `state` plus typed questions, answered in ~100 ms.
#[tauri::command]
pub async fn laya_judge(app: AppHandle, state: String, questions: Value) -> Result<Value, String> {
    let dev = devices::find(&app, "laptop")?;
    let payload = json!({ "state": state, "questions": questions }).to_string();
    let script = format!("import base64\nPAYLOAD = base64.b64decode('{}')\n{}", b64(&payload), LAYA);
    let text = exec::capture(&dev, "python3 -", Some(&script), 30).await?;
    parse(&text)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultSettings {
    pub device_id: String,
    pub root: String,
}

impl Default for VaultSettings {
    fn default() -> Self {
        // Until Syncthing mirrors it to the Pi, the vault lives on the laptop.
        Self { device_id: "laptop".into(), root: "~/Documents/saxil-obsidian/saxil".into() }
    }
}

fn vault_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("vault.json"))
}

#[tauri::command]
pub fn vault_settings_get(app: AppHandle) -> VaultSettings {
    vault_path(&app).ok().and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn vault_settings_set(app: AppHandle, settings: VaultSettings) -> Result<(), String> {
    fs::write(vault_path(&app)?, serde_json::to_string_pretty(&settings).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_op(app: AppHandle, op: String, path: Option<String>, content: Option<String>) -> Result<Value, String> {
    if !["read", "write", "append", "list"].contains(&op.as_str()) {
        return Err("bad vault op".into());
    }
    let settings = vault_settings_get(app.clone());
    let dev = devices::find(&app, &settings.device_id)?;
    let args = json!({ "root": settings.root, "op": op, "path": path.unwrap_or_default(), "content": content.unwrap_or_default() });
    let script = format!(
        "import base64, json\nARGS = json.loads(base64.b64decode('{}'))\n{}",
        b64(&args.to_string()),
        VAULT
    );
    let text = exec::capture(&dev, "python3 -", Some(&script), 30).await?;
    parse(&text)
}
