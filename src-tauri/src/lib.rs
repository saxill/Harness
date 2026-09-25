mod agent;
mod devices;
mod exec;
mod integrations;
mod probe;
mod pty;

use std::collections::HashMap;
use tokio::sync::{oneshot, Mutex};

/// Cancel handles for commands still running, keyed by the run id the UI chose.
pub struct AppState {
    pub runs: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { runs: Mutex::new(HashMap::new()) })
        .manage(pty::Ptys::default())
        .invoke_handler(tauri::generate_handler![
            devices::devices_list,
            devices::devices_save,
            exec::run_start,
            exec::run_cancel,
            exec::history_list,
            probe::probe_device,
            probe::probe_pipelines,
            agent::agent_settings_get,
            agent::agent_settings_set,
            agent::agent_key_set,
            agent::agent_key_status,
            agent::agent_complete,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            integrations::youtube_stats,
            integrations::laya_judge,
            integrations::vault_settings_get,
            integrations::vault_settings_set,
            integrations::vault_op,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
