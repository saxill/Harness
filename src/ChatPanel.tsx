// A plain chat window for Hermes and Zara: bubbles, a composer, a stop button.
import { Fragment, ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChatAgent, ChatMsg, chats } from "./chat";

const useChats = () => useSyncExternalStore(chats.subscribe, chats.getSnapshot);

const INFO: Record<ChatAgent, { name: string; where: string; hint: string; ideas: string[] }> = {
  hermes: {
    name: "Hermes", where: "on channa",
    hint: "One conversation per session. New chat starts a fresh one.",
    ideas: ["What ran today, and did anything fail?", "Check the LinkedIn queue", "Summarise my Directives"],
  },
  zara: {
    name: "Zara", where: "on the Pi",
    hint: "The same conversation as Telegram. She remembers it on both.",
    ideas: ["How did today's Shorts do?", "What's in the queue?", "Anything I should look at?"],
  },
};

// ---------- a small, safe Markdown renderer (no HTML injection) ----------

/** Links open in the system browser, not inside the app window. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    if ("__TAURI_INTERNALS__" in window) openUrl(href).catch(() => {});
    else window.open(href, "_blank", "noopener");
  };
  return <a href={href} onClick={go}>{children}</a>;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) out.push(<Link key={k} href={m[4]}>{m[3].slice(1, m[3].indexOf("]"))}</Link>);
    else if (m[5]) out.push(<Link key={k} href={m[5]}>{m[5]}</Link>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0, n = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={n++} className="md-code">{body.join("\n")}</pre>);
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d/.test(line);
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={n++}>{items.map((it, j) => <li key={j}>{inline(it, `${n}-${j}`)}</li>)}</L>);
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<div key={n++} className="md-h">{inline(line.replace(/^#+\s/, ""), `h${n}`)}</div>);
      i++;
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={n++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `${n}-${j}`)}</Fragment>)}</p>);
    }
  }
  return <>{blocks}</>;
}

// ---------- the panel ----------

function Elapsed({ from }: { from: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return <>{Math.max(0, Math.round((Date.now() - from) / 1000))}s</>;
}

function Bubble({ m, agent }: { m: ChatMsg; agent: ChatAgent }) {
  if (m.role === "user") return <div className="msg msg-user">{m.text}</div>;
  return (
    <div className={`msg msg-agent msg-${m.state}`}>
      <div className="msg-who">{INFO[agent].name.toUpperCase()}</div>
      {m.text ? <Markdown text={m.text} /> : m.state === "streaming" ? null : <p className="muted">(no reply)</p>}
      {m.state === "streaming" && (
        <div className="msg-typing"><span className="dots"><i /><i /><i /></span>{m.working ? "working with tools" : m.text ? "writing" : "thinking"} · <Elapsed from={m.at} /></div>
      )}
      {(m.state !== "streaming" && (m.tools.length > 0 || m.ms)) && (
        <div className="msg-meta">
          {m.ms ? `${(m.ms / 1000).toFixed(1)}s` : ""}{m.tools.length ? ` · ${m.tools.join(", ")}` : ""}
        </div>
      )}
      {m.state === "stopped" && <div className="msg-meta">stopped</div>}
    </div>
  );
}

/** Just the conversation, scrolling, newest at the bottom: the Home screen puts
 * it above its own message box. */
export function ChatStrip({ agent }: { agent: ChatAgent }) {
  const thread = useChats()[agent];
  const list = useRef<HTMLDivElement>(null);
  const last = thread.msgs[thread.msgs.length - 1];
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [thread.msgs.length, last?.text, last?.state]);
  return (
    <div className="convo" ref={list} aria-live="polite">
      {thread.msgs.map((m) => <Bubble key={m.id} m={m} agent={agent} />)}
    </div>
  );
}

export function ChatPanel({ agent, onTerminal, bare = false }: { agent: ChatAgent; onTerminal?: () => void; bare?: boolean }) {
  const thread = useChats()[agent];
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const info = INFO[agent];
  const busy = !!thread.busy;
  const last = thread.msgs[thread.msgs.length - 1];

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [thread.msgs.length, last?.text]);
  useEffect(() => { box.current?.focus(); }, [agent]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const send = (t = text) => {
    if (!t.trim() || busy) return;
    chats.send(agent, t);
    setText("");
  };

  return (
    <div className={`chat chat-${agent} ${bare ? "chat-bare" : ""}`}>
      {!bare && <div className="chat-head">
        <b>{info.name}</b><span className="muted small">{info.where}</span>
        <span className="spacer" />
        {onTerminal && <button className="btn btn-xs" onClick={onTerminal} title="His own terminal program, for slash commands">Terminal</button>}
        <button className="btn btn-xs" onClick={() => chats.reset(agent)} disabled={busy}>{agent === "hermes" ? "New chat" : "Clear"}</button>
      </div>}
      <div className="chat-list" ref={list}>
        {thread.msgs.length === 0 && (
          <div className="chat-empty">
            <div className="deck-big">Talk to {info.name}</div>
            <div className="muted small">{info.hint}</div>
            <div className="chat-ideas">
              {info.ideas.map((x) => <button key={x} className="chip" onClick={() => send(x)}>{x}</button>)}
            </div>
          </div>
        )}
        {thread.msgs.map((m) => <Bubble key={m.id} m={m} agent={agent} />)}
      </div>
      <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={box} rows={1} value={text} placeholder={`Message ${info.name}…  (Enter to send, Shift+Enter for a new line)`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        {busy
          ? <button type="button" className="hud-btn" onClick={() => chats.stop(agent)}>Stop</button>
          : <button type="submit" className="hud-btn" disabled={!text.trim()}>Send</button>}
      </form>
    </div>
  );
}
