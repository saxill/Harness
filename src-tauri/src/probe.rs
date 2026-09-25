//! Status probes. Unix boxes get a stdlib-only Python script on stdin; Windows
//! gets a PowerShell script. The Pi additionally reports its pipelines by
//! calling the `dash` module in its bridge folder directly over SSH, so the
//! app never needs the bridge token.
use crate::{devices, exec};
use serde_json::Value;
use tauri::AppHandle;

const PROBE_UNIX: &str = include_str!("scripts/probe_unix.py");
const PROBE_WINDOWS: &str = include_str!("scripts/probe_windows.ps1");
const PIPELINES: &str = "import sys, json\n\
sys.path.insert(0, '/home/saxill/storage/zara-bridge')\n\
import dash\n\
print(json.dumps(dash.status()))\n";

fn first_json(text: &str) -> Result<Value, String> {
    let start = text.find('{').ok_or("no JSON in probe output")?;
    let end = text.rfind('}').ok_or("no JSON in probe output")?;
    serde_json::from_str(&text[start..=end]).map_err(|e| format!("bad probe JSON: {e}"))
}

#[tauri::command]
pub async fn probe_device(app: AppHandle, device_id: String) -> Result<Value, String> {
    let dev = devices::find(&app, &device_id)?;
    let text = if dev.kind == "windows" {
        exec::capture(&dev, PROBE_WINDOWS, None, 40).await?
    } else {
        exec::capture(&dev, "python3 -", Some(PROBE_UNIX), 25).await?
    };
    first_json(&text)
}

#[tauri::command]
pub async fn probe_pipelines(app: AppHandle, device_id: String) -> Result<Value, String> {
    let dev = devices::find(&app, &device_id)?;
    if !dev.pipelines {
        return Err(format!("{} has no pipelines", dev.name));
    }
    let text = exec::capture(&dev, "python3 -", Some(PIPELINES), 60).await?;
    first_json(&text)
}
