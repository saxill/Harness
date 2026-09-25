// Conversations with Hermes and Zara for the chat panel. Each send is one
// non-interactive turn on their machine (chat.rs); replies stream in as JSON
// lines. Recent messages are kept in this browser so the panel survives a
// restart; the real history lives with each agent.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Emitter } from "./api";

export type ChatAgent = "hermes" | "zara";
export interface ChatMsg {
  id: string;
  role: "user" | "agent";
  text: string;
  at: number;
  state: "done" | "streaming" | "error" | "stopped";
  tools: string[];
  working?: boolean;
  ms?: number;
}
interface Thread { msgs: ChatMsg[]; session?: string; busy?: string }

const KEEP = 80;
const key = (a: ChatAgent) => `harness.chat.${a}`;
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function load(a: ChatAgent): Thread {
  try {
    const t = JSON.parse(localStorage.getItem(key(a)) ?? "") as Thread;
    // a turn that was running when the app closed can't finish now
    t.msgs = (t.msgs ?? []).map((m) => (m.state === "streaming" ? { ...m, state: "stopped" as const, working: false } : m));
    return { msgs: t.msgs, session: t.session };
  } catch {
    return { msgs: [] };
  }
}

class ChatStore extends Emitter {
  threads: Record<ChatAgent, Thread> = { hermes: load("hermes"), zara: load("zara") };
  private snapshot = { ...this.threads };
  private turns = new Map<string, { agent: ChatAgent; msgId: string; raw: string[]; gotText: boolean }>();
  private started = false;

  getSnapshot = () => this.snapshot;

  private publish(agent: ChatAgent) {
    const t = this.threads[agent];
    this.threads = { ...this.threads, [agent]: { ...t, msgs: [...t.msgs] } };
    this.snapshot = this.threads;
    try {
      localStorage.setItem(key(agent), JSON.stringify({ msgs: t.msgs.slice(-KEEP), session: t.session }));
    } catch { /* storage may be unavailable; the chat still works */ }
    this.emit();
  }

  private patch(agent: ChatAgent, msgId: string, f: (m: ChatMsg) => ChatMsg) {
    const t = this.threads[agent];
    t.msgs = t.msgs.map((m) => (m.id === msgId ? f(m) : m));
    this.publish(agent);
  }

  async init() {
    if (this.started) return;
    this.started = true;
    await listen<{ turnId: string; line: string }>("chat://line", (e) => this.onLine(e.payload.turnId, e.payload.line));
    await listen<{ turnId: string; code: number | null; cancelled: boolean; stderr: string[] }>("chat://done", (e) => this.onDone(e.payload));
  }

  private onLine(turnId: string, line: string) {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line); } catch { turn.raw.push(line); return; }
    const type = String(ev.type ?? "");
    const sid = typeof ev.session_id === "string" ? ev.session_id : undefined;
    if (sid && turn.agent === "hermes") this.threads.hermes.session = sid;
    if (type === "text" && typeof ev.text === "string") {
      const first = !turn.gotText;
      turn.gotText = true;
      this.patch(turn.agent, turn.msgId, (m) => ({ ...m, text: (first ? "" : m.text) + ev.text, working: false }));
    } else if (type === "result") {
      const tools = Array.isArray(ev.tools) ? (ev.tools as string[]) : undefined;
      this.patch(turn.agent, turn.msgId, (m) => ({
        ...m, text: typeof ev.text === "string" && ev.text ? ev.text : m.text, state: "done", working: false,
        tools: tools ?? m.tools, ms: typeof ev.duration_ms === "number" ? ev.duration_ms : m.ms,
      }));
    } else if (type === "error") {
      this.patch(turn.agent, turn.msgId, (m) => ({ ...m, text: String(ev.text ?? "error"), state: "error", working: false }));
    } else if (type === "tool" || type.startsWith("tool")) {
      const name = typeof ev.name === "string" ? ev.name : typeof ev.tool === "string" ? ev.tool : "";
      this.patch(turn.agent, turn.msgId, (m) => ({ ...m, working: true, tools: name && !m.tools.includes(name) ? [...m.tools, name] : m.tools }));
    }
  }

  private onDone(d: { turnId: string; code: number | null; cancelled: boolean; stderr: string[] }) {
    const turn = this.turns.get(d.turnId);
    if (!turn) return;
    this.turns.delete(d.turnId);
    this.threads[turn.agent].busy = undefined;
    this.patch(turn.agent, turn.msgId, (m) => {
      if (m.state === "done" || m.state === "error") return m;
      if (d.cancelled) return { ...m, state: "stopped", working: false };
      if (m.text) return { ...m, state: "done", working: false };
      const why = [...turn.raw, ...d.stderr].filter((l) => l.trim()).slice(-3).join("\n");
      return { ...m, state: "error", working: false, text: why || `no reply (exit ${d.code ?? "?"})` };
    });
  }

  async send(agent: ChatAgent, text: string) {
    const t = this.threads[agent];
    if (t.busy || !text.trim()) return;
    const turnId = newId();
    const reply: ChatMsg = { id: newId(), role: "agent", text: "", at: Date.now(), state: "streaming", tools: [], working: true };
    t.msgs = [...t.msgs, { id: newId(), role: "user", text: text.trim(), at: Date.now(), state: "done", tools: [] }, reply];
    t.busy = turnId;
    this.turns.set(turnId, { agent, msgId: reply.id, raw: [], gotText: false });
    this.publish(agent);
    try {
      await invoke("chat_send", { turnId, agent, message: text.trim(), session: agent === "hermes" ? t.session ?? null : null });
    } catch (e) {
      this.turns.delete(turnId);
      t.busy = undefined;
      this.patch(agent, reply.id, (m) => ({ ...m, state: "error", working: false, text: String(e) }));
    }
  }

  stop(agent: ChatAgent) {
    const id = this.threads[agent].busy;
    if (id) invoke("run_cancel", { runId: id }).catch(() => {});
  }

  /** Hermes: start a new session. Zara has one conversation (shared with Telegram), so this only clears the panel. */
  reset(agent: ChatAgent) {
    const t = this.threads[agent];
    if (t.busy) return;
    t.msgs = [];
    t.session = undefined;
    this.publish(agent);
  }
}

export const chats = new ChatStore();
