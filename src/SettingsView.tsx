import { useEffect, useState } from "react";
import { AgentSettings, api, Device, statusStore } from "./api";
import { useStatus } from "./components";
import { setYtChannels, VaultSettings, vault, youtube, ytChannels } from "./hub";

const PRESETS: { name: string; baseUrl: string; model: string; note: string }[] = [
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", note: "Most reliable at deciding when to run a command." },
  { name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-ultra-550b-a55b", note: "What Zara and Hermes use. Sometimes skips tool calls." },
  { name: "Ollama Cloud", baseUrl: "https://ollama.com/v1", model: "gpt-oss:120b", note: "Has a weekly usage limit." },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5", note: "" },
];

export default function SettingsView() {
  const { devices } = useStatus();
  const [agent, setAgent] = useState<AgentSettings>({ baseUrl: "", model: "" });
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Device[]>([]);
  const [channels, setChannels] = useState(ytChannels().join(", "));
  const [vs, setVs] = useState<VaultSettings>({ deviceId: "laptop", root: "" });
  useEffect(() => { vault.settings().then(setVs); }, []);

  useEffect(() => {
    api.agentSettings().then(setAgent);
    api.hasKey().then(setHasKey);
  }, []);
  useEffect(() => { setDraft(devices.map((d) => ({ ...d }))); }, [devices]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const saveAgent = async () => {
    await api.saveAgentSettings(agent);
    if (key.trim()) {
      const where = await api.setKey(key);
      setKey("");
      setHasKey(true);
      flash(where === "keychain" ? "Saved. Key stored in the system keychain." : "Saved. Key stored in a private file (no keychain available).");
    } else flash("Saved.");
  };

  const saveDevices = async () => {
    await api.saveDevices(draft.map(({ isLocal: _l, ...d }) => ({ ...d, isLocal: false })));
    await statusStore.reloadDevices();
    flash("Machines saved.");
  };

  const edit = (id: string, field: keyof Device, value: string) =>
    setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, [field]: value } : d)));

  return (
    <div className="view">
      <div className="view-head"><h1>Settings</h1>{msg && <span className="tone-ok small">{msg}</span>}</div>

      <section className="card panel">
        <h2>Agent model</h2>
        <p className="muted small">Any OpenAI-compatible endpoint. The key goes straight to the system keychain; the app's interface never sees it again.</p>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.name} className={`chip ${agent.baseUrl === p.baseUrl ? "chip-on" : ""}`}
              title={p.note} onClick={() => setAgent({ baseUrl: p.baseUrl, model: p.model })}>{p.name}</button>
          ))}
        </div>
        <label className="field"><span>Base URL</span>
          <input value={agent.baseUrl} spellCheck={false} onChange={(e) => setAgent({ ...agent, baseUrl: e.target.value })} /></label>
        <label className="field"><span>Model</span>
          <input value={agent.model} spellCheck={false} onChange={(e) => setAgent({ ...agent, model: e.target.value })} /></label>
        <label className="field"><span>API key</span>
          <input type="password" value={key} autoComplete="off" placeholder={hasKey ? "•••••••• stored — paste to replace" : "Paste your key"}
            onChange={(e) => setKey(e.target.value)} /></label>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={saveAgent}>Save</button>
          {hasKey && <button className="btn" onClick={async () => { await api.setKey(""); setHasKey(false); flash("Key removed."); }}>Remove key</button>}
        </div>
        <p className="small muted">{PRESETS.find((p) => p.baseUrl === agent.baseUrl)?.note}</p>
      </section>

      <section className="card panel">
        <h2>YouTube channels</h2>
        <p className="muted small">Public stats read with yt-dlp on the Pi — no login or API key. Separate handles with commas.</p>
        <label className="field"><span>Handles</span>
          <input value={channels} spellCheck={false} onChange={(e) => setChannels(e.target.value)} placeholder="@bytsyz1, @another" /></label>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => {
            setYtChannels(channels.split(/[\s,]+/).filter(Boolean).map((c) => (c.startsWith("@") ? c : "@" + c)));
            youtube.refresh(); flash("Channels saved.");
          }}>Save channels</button>
        </div>
      </section>

      <section className="card panel">
        <h2>Obsidian vault</h2>
        <p className="muted small">Where Directives, Harness logs and agent reports are read and written. Once Syncthing mirrors the vault to the Pi, point this at the Pi so it works while the laptop sleeps.</p>
        <label className="field"><span>Machine</span>
          <select value={vs.deviceId} onChange={(e) => setVs({ ...vs, deviceId: e.target.value })}>
            {devices.filter((d) => d.kind !== "windows").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <label className="field"><span>Folder</span>
          <input value={vs.root} spellCheck={false} onChange={(e) => setVs({ ...vs, root: e.target.value })} /></label>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={async () => {
            await vault.setSettings(vs);
            const r = await vault.list().catch(() => null);
            flash(r?.exists ? `Vault found: ${r.notes.length} notes.` : "Saved, but no vault folder found there.");
          }}>Save & test</button>
        </div>
      </section>

      <section className="card panel">
        <h2>Machines</h2>
        <p className="muted small">Reached with <code>ssh user@address</code> using this computer's own SSH keys. The machine whose address belongs to this computer runs commands locally.</p>
        <table className="table">
          <thead><tr><th>Name</th><th>SSH target</th><th>Role</th><th>OS</th></tr></thead>
          <tbody>
            {draft.map((d) => (
              <tr key={d.id}>
                <td><input value={d.name} onChange={(e) => edit(d.id, "name", e.target.value)} /></td>
                <td><input value={d.host} spellCheck={false} onChange={(e) => edit(d.id, "host", e.target.value)} /></td>
                <td><input value={d.role} onChange={(e) => edit(d.id, "role", e.target.value)} /></td>
                <td className="muted">{d.kind}{d.isLocal ? " · this one" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="btn-row"><button className="btn btn-primary" onClick={saveDevices}>Save machines</button></div>
      </section>
    </div>
  );
}
