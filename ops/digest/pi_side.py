# Runs on the Pi (piped to `python3 - START END`): what the pipelines did
# between two epoch seconds, plus their state right now. Read-only.
import glob, json, os, sqlite3, sys

sys.path.insert(0, "/home/saxill/storage/zara-bridge")
import dash

start, end = int(sys.argv[1]), int(sys.argv[2])


def rows(db, query, args=()):
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        try:
            return con.execute(query, args).fetchall()
        finally:
            con.close()
    except Exception:
        return []


def title(job_id):
    for path in (f"{dash.OUTBOX}/{job_id}/meta.json", f"{dash.FACTORY_JOBS}/{job_id}/meta.json",
                 *glob.glob(f"{dash.OUTBOX}/*/{job_id}/meta.json")):
        try:
            with open(path) as f:
                t = json.load(f).get("title")
            if t:
                return t
        except Exception:
            pass
    return ""


yt = [{"job_id": j, "url": u, "at": a, "title": title(j)} for j, u, a in rows(
    f"{dash.POSTER}/poster.db",
    "select job_id, video_url, updated_at from posts where status='posted' and updated_at between ? and ? order by updated_at",
    (start, end))]
yt_failed = [{"job_id": j, "status": s, "error": (e or "")[:200], "title": title(j)} for j, s, e in rows(
    f"{dash.POSTER}/poster.db",
    "select job_id, status, last_error from posts where status='failed' and updated_at between ? and ?", (start, end))]
ig = [{"job_id": j, "at": a, "title": title(j)} for j, a in rows(
    f"{dash.IG_POSTER}/ig_poster.db",
    "select job_id, posted_at from posts where status='posted' and posted_at between ? and ?",
    (start, end))]
carousels = [{"id": i, "at": a, "url": u} for i, a, u in rows(
    f"{dash.IG_POSTER}/ig_poster.db",
    "select id, posted_at, post_url from carousels where status='posted' and posted_at between ? and ?",
    (start, end))]

print(json.dumps({"status": dash.status(), "youtube": yt, "youtube_failed": yt_failed,
                  "instagram": ig, "carousels": carousels}))
