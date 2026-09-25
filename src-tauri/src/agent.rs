//! The agent's line to a language model. Any OpenAI-compatible endpoint works
//! (NVIDIA NIM, Ollama, OpenAI, Anthropic's compatibility API). The API key
//! lives in the OS keychain and never crosses into the web view; the UI only
//! ever learns whether one is set.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use tauri::{AppHandle, Manager};

const KEYCHAIN_SERVICE: &str = "com.sahilchanna.harness";
const KEYCHAIN_USER: &str = "llm-api-key";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    pub base_url: String,
    pub model: String,
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            base_url: "https://integrate.api.nvidia.com/v1".into(),
            model: "nvidia/nemotron-3-ultra-550b-a55b".into(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("agent.json"))
}

fn key_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings_path(app)?.with_file_name(".llm-key"))
}

/// Keychain first. Linux desktops without a Secret Service daemon fall back to
/// a 0600 file in the app's config folder.
fn read_key(app: &AppHandle) -> Option<String> {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER) {
        if let Ok(k) = entry.get_password() {
            return Some(k);
        }
    }
    fs::read_to_string(key_file(app).ok()?).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn agent_settings_get(app: AppHandle) -> AgentSettings {
    settings_path(&app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn agent_settings_set(app: AppHandle, settings: AgentSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(&app)?, json).map_err(|e| e.to_string())
}

/// Stores the key; an empty string removes it. Returns where it went.
#[tauri::command]
pub fn agent_key_set(app: AppHandle, key: String) -> Result<String, String> {
    let key = key.trim().to_string();
    let file = key_file(&app)?;
    if key.is_empty() {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER) {
            let _ = entry.delete_credential();
        }
        let _ = fs::remove_file(file);
        return Ok("removed".into());
    }
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER) {
        if entry.set_password(&key).is_ok() && entry.get_password().ok().as_deref() == Some(key.as_str()) {
            let _ = fs::remove_file(&file);
            return Ok("keychain".into());
        }
    }
    fs::write(&file, &key).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&file, fs::Permissions::from_mode(0o600));
    }
    Ok("file".into())
}

#[tauri::command]
pub fn agent_key_status(app: AppHandle) -> bool {
    read_key(&app).is_some()
}

/// One chat-completions round trip; returns the assistant message (which may
/// carry tool_calls). The agent loop itself lives in the UI, where approvals are.
#[tauri::command]
pub async fn agent_complete(app: AppHandle, messages: Value, tools: Value) -> Result<Value, String> {
    let settings = agent_settings_get(app.clone());
    let key = read_key(&app).ok_or("No API key set — add one in Settings.")?;
    let url = format!("{}/chat/completions", settings.base_url.trim_end_matches('/'));
    let body = json!({
        "model": settings.model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.2,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(key)
        .json(&body)
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{status}: {}", text.chars().take(400).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("bad response: {e}"))?;
    v["choices"][0]["message"].clone().as_object().map(|_| v["choices"][0]["message"].clone())
        .ok_or_else(|| format!("no message in response: {}", text.chars().take(300).collect::<String>()))
}
