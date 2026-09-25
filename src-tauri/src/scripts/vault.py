# Reads, writes or appends one note in the vault. ARGS is prepended:
# {"root": ..., "path": ..., "op": "read"|"write"|"append"|"list", "content": ...}
import json, os
root = os.path.realpath(os.path.expanduser(ARGS["root"]))
target = os.path.realpath(os.path.join(root, ARGS.get("path", "")))
if not (target == root or target.startswith(root + os.sep)):
    raise SystemExit("path escapes the vault")
op = ARGS["op"]
if op == "list":
    notes = []
    for d, _, files in os.walk(root):
        if "/." in d.replace(root, ""):
            continue
        for f in files:
            if f.endswith(".md"):
                p = os.path.join(d, f)
                notes.append({"path": os.path.relpath(p, root), "mtime": int(os.path.getmtime(p))})
    print(json.dumps({"exists": os.path.isdir(root), "notes": sorted(notes, key=lambda n: -n["mtime"])[:200]}))
elif op == "read":
    print(json.dumps({"exists": os.path.exists(target), "content": open(target).read() if os.path.exists(target) else ""}))
else:
    if not target.endswith(".md"):
        raise SystemExit("only .md notes can be written")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "a" if op == "append" else "w") as f:
        f.write(ARGS["content"])
    print(json.dumps({"ok": True, "path": os.path.relpath(target, root)}))
