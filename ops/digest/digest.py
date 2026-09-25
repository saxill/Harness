#!/usr/bin/env python3
"""Daily pipeline digest, written into the day's Obsidian note.

Runs on the Linux laptop from a user timer at 21:30. It asks the Pi what the
Shorts / Instagram / LinkedIn pipelines did that day, pulls the YouTube channel
numbers, and puts a "Pipelines" section into Daily/YYYY-MM-DD.md between
markers, so re-running replaces the section instead of duplicating it and
anything the user wrote in the note is left alone.

  digest.py                 today after 21:00, otherwise yesterday (timer catch-up)
  digest.py --date today    force a date (today, yesterday or YYYY-MM-DD)
  digest.py --print         print the section instead of writing it
"""
import argparse, datetime as dt, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.realpath(__file__))
PI = os.environ.get("HARNESS_PI", "saxill@100.90.23.49")
VAULT = os.path.expanduser(os.environ.get("HARNESS_VAULT", "~/Documents/saxil-obsidian/saxil"))
CHANNELS = os.environ.get("HARNESS_YT_CHANNELS", "@bytsyz1").split()
YOUTUBE_PY = os.path.join(HERE, "..", "..", "src-tauri", "src", "scripts", "youtube.py")
BEGIN, END = "<!-- harness:digest -->", "<!-- /harness:digest -->"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15"]


def on_pi(script_path, remote_cmd, timeout):
    with open(script_path, "rb") as f:
        p = subprocess.run(SSH + [PI, remote_cmd], stdin=f, capture_output=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode(errors="replace").strip().splitlines()[-1:] or f"exit {p.returncode}")
    return json.loads(p.stdout)


def target_date(arg):
    now = dt.datetime.now()
    if arg == "today":
        return now.date()
    if arg == "yesterday":
        return now.date() - dt.timedelta(days=1)
    if arg:
        return dt.date.fromisoformat(arg)
    return now.date() if now.hour >= 21 else now.date() - dt.timedelta(days=1)


def hm(ts):
    return dt.datetime.fromtimestamp(ts).strftime("%H:%M") if ts else "--:--"


def n(v):
    return f"{v:,}" if isinstance(v, int) else "?"


def signed(v):
    return f"+{v:,}" if v > 0 else f"{v:,}"


def md_link(text, url):
    text = text.replace("[", "(").replace("]", ")")
    return f"[{text}]({url})" if url else text


def video_id(url):
    m = re.search(r"(?:shorts/|v=|youtu\.be/)([\w-]{11})", url or "")
    return m.group(1) if m else None


def render(day, pi, yt, errors):
    s = pi.get("status") or {}
    lines = [BEGIN, "## Pipelines",
             f"*Harness digest for {day:%a %d %b}, written {dt.datetime.now():%H:%M}. "
             "Queue, held and service lines are as of that time.*", ""]

    views = {}
    for ch in (yt or {}).get("channels", []):
        for it in ch.get("items") or []:
            views[it.get("id")] = it.get("views")
        hist = ch.get("history") or []
        delta = ""
        if len(hist) >= 2 and isinstance(hist[-1].get("subscribers"), int) and isinstance(hist[-2].get("subscribers"), int):
            a, b = hist[-2], hist[-1]
            since = dt.datetime.fromtimestamp(a["ts"]).strftime("%d %b %H:%M")
            delta = (f" ({signed(b['subscribers'] - a['subscribers'])} subs, "
                     f"{signed(b['total_views'] - a['total_views'])} views since {since})")
        if ch.get("error"):
            lines.append(f"**YouTube {ch['handle']}**: couldn't read the channel ({ch['error']})")
        else:
            l7 = ch.get("last7") or {}
            lines.append(f"**YouTube {ch['handle']}**: {n(ch.get('subscribers'))} subs, "
                         f"{n(ch.get('total_views'))} views{delta}. Last 7 days: "
                         f"{l7.get('posted', 0)} Shorts, {n(l7.get('views'))} views.")
    lines.append("")

    posted = pi.get("youtube") or []
    lines.append(f"**Posted to YouTube** ({len(posted)})")
    for p in posted:
        v = views.get(video_id(p.get("url")))
        tail = f" · {v:,} views" if isinstance(v, int) else ""
        lines.append(f"- {hm(p.get('at'))} {md_link(p.get('title') or p['job_id'][:8], p.get('url'))}{tail}")
    if not posted:
        lines.append("- nothing")
    ig = pi.get("instagram") or []
    if ig:
        lines.append(f"- Instagram: {len(ig)} reel{'s' if len(ig) != 1 else ''} cross-posted "
                     f"({'; '.join((i.get('title') or i['job_id'][:8]) for i in ig)})")
    for c in pi.get("carousels") or []:
        lines.append(f"- Carousel {hm(c.get('at'))}: {md_link(c['id'], c.get('url'))}")
    lines.append("")

    needs = []
    for f in pi.get("youtube_failed") or []:
        needs.append(f"YouTube post failed: {f.get('title') or f['job_id'][:8]}: {f.get('error') or 'no error text'}")
    last_ig = (s.get("posting") or {}).get("last_instagram") or {}
    if last_ig.get("status") == "failed" and last_ig.get("at", 0) >= pi.get("_start", 0):
        needs.append(f"Instagram cross-post failed at {hm(last_ig.get('at'))}: {last_ig.get('error') or 'no error text'}")
    held = s.get("held") or []
    if held:
        names = "; ".join((h.get("title") or h["job_id"][:8]) for h in held[:5])
        needs.append(f"{len(held)} Short{'s' if len(held) != 1 else ''} held: {names}{' …' if len(held) > 5 else ''}")
    pend = (s.get("linkedin") or {}).get("pending_approvals") or []
    if pend:
        needs.append(f"LinkedIn: {len(pend)} draft{'s' if len(pend) != 1 else ''} waiting for your approval")
    for svc in s.get("services") or []:
        if svc.get("state") != "active":
            needs.append(f"Service {svc['name']} is {svc.get('state')}")
    for name, d in ((s.get("host") or {}).get("disks") or {}).items():
        if (d.get("used_percent") or 0) >= 90:
            needs.append(f"Pi {name} disk {d['used_percent']}% full ({d.get('free_gb')} GB free)")
    blocked = ((s.get("factory") or {}).get("counts") or {}).get("blocked")
    if blocked:
        needs.append(f"Factory: {blocked} job{'s' if blocked != 1 else ''} blocked")
    needs += errors
    lines.append("**Needs you**")
    lines += [f"- [ ] {x}" for x in needs] or ["- nothing"]
    lines.append("")

    counts = (s.get("factory") or {}).get("counts") or {}
    queue = s.get("queue") or []
    host = s.get("host") or {}
    lines.append("**State**")
    if counts:
        lines.append("- Factory: " + ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    lines.append(f"- Queue: {len(queue)} waiting, {sum(1 for q in queue if q.get('fact_checked'))} fact-checked")
    if host:
        disks = host.get("disks") or {}
        up = (host.get("uptime_seconds") or 0) // 86400
        lines.append(f"- Pi: {host.get('cpu_temp_c', '?')} °C, SD {disks.get('root', {}).get('used_percent', '?')}%, "
                     f"storage {disks.get('storage', {}).get('used_percent', '?')}%, up {up} d")
    lines.append(END)
    return "\n".join(lines)


def write(day, section):
    path = os.path.join(VAULT, "Daily", f"{day.isoformat()}.md")
    if os.path.exists(path):
        with open(path) as f:
            text = f.read()
    else:
        try:
            with open(os.path.join(VAULT, "Templates", "Daily Note.md")) as f:
                text = f.read().replace("{{date}}", day.isoformat())
        except FileNotFoundError:
            text = f"# {day.isoformat()}\n"
    if BEGIN in text and END in text:
        text = text[:text.index(BEGIN)] + section + text[text.index(END) + len(END):]
    elif "\n## Links" in text:
        i = text.index("\n## Links")
        text = text[:i].rstrip("\n") + "\n\n" + section + "\n" + text[i:]
    else:
        text = text.rstrip("\n") + "\n\n" + section + "\n"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".harness-tmp"
    with open(tmp, "w") as f:
        f.write(text)
    os.replace(tmp, path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--print", action="store_true")
    a = ap.parse_args()
    day = target_date(a.date)
    start = int(dt.datetime.combine(day, dt.time.min).timestamp())
    end = int(dt.datetime.combine(day, dt.time.max).timestamp())

    errors = []
    try:
        pi = on_pi(os.path.join(HERE, "pi_side.py"), f"python3 - {start} {end}", 60)
        pi["_start"] = start
    except Exception as e:
        pi = {}
        errors.append(f"Couldn't reach the Pi pipelines: {e}")
    try:
        yt = on_pi(YOUTUBE_PY, "bash -lc 'python3 - " + " ".join(CHANNELS) + "'", 240)
    except Exception as e:
        yt = None
        errors.append(f"Couldn't read YouTube: {e}")

    section = render(day, pi, yt, errors)
    if a.print:
        print(section)
    else:
        print(write(day, section))
    return 1 if not pi else 0


if __name__ == "__main__":
    sys.exit(main())
