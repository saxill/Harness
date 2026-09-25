//! The four machines. Stored as JSON in the app config dir so hosts can be
//! edited without a rebuild; the defaults below are the tailnet as of Sep 2026.
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::PathBuf, process::Command};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    /// macos | linux | windows — picks the shell and the status probe.
    pub kind: String,
    /// `user@address`, used for SSH when the device is not this machine.
    pub host: String,
    pub role: String,
    /// The Pi also reports the Shorts / LinkedIn / Hermes pipelines.
    #[serde(default)]
    pub pipelines: bool,
    /// Filled in at runtime: true when `host`'s address belongs to this machine.
    #[serde(default)]
    pub is_local: bool,
}

pub fn defaults() -> Vec<Device> {
    let d = |id: &str, name: &str, kind: &str, host: &str, role: &str, pipelines: bool| Device {
        id: id.into(),
        name: name.into(),
        kind: kind.into(),
        host: host.into(),
        role: role.into(),
        pipelines,
        is_local: false,
    };
    vec![
        d("mac", "MacBook", "macos", "sahil@100.106.218.120", "Laptop · Xcode, Claude", false),
        d("channa", "channa", "windows", "Admin@100.111.91.80", "Hermes · carousels", false),
        d("pi", "Pi", "linux", "saxill@100.90.23.49", "Zara · Shorts · LinkedIn", true),
        d("laptop", "Linux laptop", "linux", "saxill@100.120.253.10", "Omarchy", false),
    ]
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("devices.json"))
}

/// IPv4 addresses on this machine's interfaces (Tailscale's included). The
/// Mac reports its DHCP address as its hostname, so names are useless here.
fn local_addresses() -> HashSet<String> {
    let out = if cfg!(target_os = "macos") {
        Command::new("/sbin/ifconfig").output()
    } else {
        Command::new("ip").args(["-4", "-o", "addr", "show"]).output()
    };
    let text = out.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    let re = Regex::new(r"inet (\d+\.\d+\.\d+\.\d+)").unwrap();
    re.captures_iter(&text).map(|c| c[1].to_string()).collect()
}

pub fn address(host: &str) -> &str {
    host.rsplit('@').next().unwrap_or(host)
}

pub fn load(app: &AppHandle) -> Vec<Device> {
    let mut devices: Vec<Device> = config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(defaults);
    let local = local_addresses();
    for d in devices.iter_mut() {
        d.is_local = local.contains(address(&d.host));
    }
    devices
}

pub fn find(app: &AppHandle, id: &str) -> Result<Device, String> {
    load(app).into_iter().find(|d| d.id == id).ok_or_else(|| format!("no device '{id}'"))
}

#[tauri::command]
pub fn devices_list(app: AppHandle) -> Vec<Device> {
    load(&app)
}

#[tauri::command]
pub fn devices_save(app: AppHandle, devices: Vec<Device>) -> Result<(), String> {
    let path = config_path(&app)?;
    let json = serde_json::to_string_pretty(&devices).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
