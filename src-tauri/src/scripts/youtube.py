# YouTube channel stats, run on the Pi. Public data only via yt-dlp (no login,
# no API key), joined with the poster's records for exact posting times.
# Appends at most one snapshot an hour so growth can be charted over time.
import json, os, re, sqlite3, statistics, subprocess, sys, time

HANDLES = [h if h.startswith("@") else "@" + h for h in sys.argv[1:]] or ["@bytsyz1"]
SNAP = os.path.expanduser("~/storage/zara-bridge/yt_snapshots.jsonl")

def flat(url, n):
    try:
        p = subprocess.run(["yt-dlp", "--flat-playlist", "--playlist-end", str(n), "-J", url],
                           capture_output=True, text=True, timeout=180)
        return json.loads(p.stdout) if p.stdout.strip() else {"_error": (p.stderr or "no output").strip()[-200:]}
    except Exception as e:
        return {"_error": str(e)}

posted = {}
try:
    db = sqlite3.connect("file:" + os.path.expanduser("~/storage/shorts-poster/poster.db") + "?mode=ro", uri=True)
    for url, ts in db.execute("select video_url, updated_at from posts where status='posted' and video_url is not null"):
        m = re.search(r"(?:shorts/|v=|youtu\.be/)([\w-]{11})", url or "")
        if m:
            posted[m.group(1)] = int(ts)
except Exception:
    pass

snaps = []
try:
    snaps = [json.loads(l) for l in open(SNAP) if l.strip()]
except Exception:
    pass

now = time.time()
out = {"generated": int(now), "channels": []}
for h in HANDLES:
    base = f"https://www.youtube.com/{h}"
    shorts, videos = flat(base + "/shorts", 400), flat(base + "/videos", 100)
    items = []
    for kind, pl in (("short", shorts), ("video", videos)):
        for e in pl.get("entries") or []:
            items.append({"id": e.get("id"), "title": e.get("title") or "", "views": e.get("view_count"),
                          "kind": kind, "posted_at": posted.get(e.get("id"))})
    views = [i["views"] for i in items if isinstance(i["views"], int)]
    subs = shorts.get("channel_follower_count") or videos.get("channel_follower_count")
    week = now - 7 * 86400
    recent = [i for i in items if i["posted_at"] and i["posted_at"] >= week]
    ch = {
        "handle": h, "name": shorts.get("channel") or videos.get("channel") or h, "url": base,
        "subscribers": subs, "count": len(items), "shorts": sum(1 for i in items if i["kind"] == "short"),
        "total_views": sum(views), "median_views": int(statistics.median(views)) if views else 0,
        "last7": {"posted": len(recent), "views": sum(i["views"] or 0 for i in recent)},
        "items": items[:120],
        "error": None if items else (shorts.get("_error") or "no videos found"),
    }
    last = next((s for s in reversed(snaps) if s.get("handle") == h), None)
    if items and (not last or now - last["ts"] > 3600):
        snap = {"handle": h, "ts": int(now), "subscribers": subs, "total_views": ch["total_views"], "count": len(items)}
        try:
            with open(SNAP, "a") as f:
                f.write(json.dumps(snap) + "\n")
        except Exception:
            pass
        snaps.append(snap)
    daily = {}
    for s in snaps:
        if s.get("handle") == h and s["ts"] > now - 90 * 86400:
            daily[time.strftime("%Y-%m-%d", time.localtime(s["ts"]))] = s
    ch["history"] = [daily[k] for k in sorted(daily)]
    out["channels"].append(ch)
print(json.dumps(out))
