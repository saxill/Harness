# Status probe for macOS and Linux. Fed to `python3 -` over SSH; prints one
# JSON object. Standard library only, so it runs on every box as-is.
import glob, json, os, platform, re, shutil, socket, subprocess, time

def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=8).stdout.strip()
    except Exception:
        return ""

out = {"hostname": socket.gethostname(), "os": platform.system(), "arch": platform.machine()}
out["load"] = [round(x, 2) for x in os.getloadavg()]
out["cpus"] = os.cpu_count()

if out["os"] == "Linux":
    try:
        out["uptime_s"] = int(float(open("/proc/uptime").read().split()[0]))
    except Exception:
        pass
    try:
        mi = {}
        for line in open("/proc/meminfo"):
            k, v = line.split(":", 1)
            mi[k] = int(v.split()[0])
        out["mem_total_mb"] = mi["MemTotal"] // 1024
        out["mem_avail_mb"] = mi.get("MemAvailable", mi.get("MemFree", 0)) // 1024
    except Exception:
        pass
    try:
        for line in open("/etc/os-release"):
            if line.startswith("PRETTY_NAME="):
                out["os_pretty"] = line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    temps = []
    for z in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
        try:
            temps.append(int(open(z).read().strip()) / 1000)
        except Exception:
            pass
    if temps:
        out["temp_c"] = round(max(temps), 1)
    failed = sh("systemctl --failed --no-legend --plain 2>/dev/null | grep -c .")
    out["failed_units"] = int(failed) if failed.isdigit() else 0
    if out["failed_units"]:
        out["failed_names"] = sh("systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | head -5").split()
    for b in glob.glob("/sys/class/power_supply/BAT*"):
        try:
            out["battery"] = {"percent": int(open(b + "/capacity").read()),
                              "state": open(b + "/status").read().strip().lower()}
        except Exception:
            pass
elif out["os"] == "Darwin":
    m = re.search(r"sec = (\d+)", sh("sysctl -n kern.boottime"))
    if m:
        out["uptime_s"] = int(time.time()) - int(m.group(1))
    total = sh("sysctl -n hw.memsize")
    if total.isdigit():
        out["mem_total_mb"] = int(total) // 1048576
        vm = sh("vm_stat")
        page = int((re.search(r"page size of (\d+)", vm) or [0, 4096])[1])
        pages = {k.strip(): int(v.strip().rstrip(".")) for k, v in
                 (l.split(":", 1) for l in vm.splitlines()[1:] if ":" in l) if v.strip().rstrip(".").isdigit()}
        free = sum(pages.get(k, 0) for k in ("Pages free", "Pages inactive", "Pages speculative", "Pages purgeable"))
        out["mem_avail_mb"] = free * page // 1048576
    out["os_pretty"] = "macOS " + sh("sw_vers -productVersion")
    batt = sh("pmset -g batt")
    m = re.search(r"(\d+)%;\s*([a-zA-Z ]+);", batt)
    if m:
        out["battery"] = {"percent": int(m.group(1)), "state": m.group(2).strip().lower()}

disks, seen = [], set()
for label, path in (("/", "/"), ("home", os.path.expanduser("~")), ("storage", "/home/saxill/storage")):
    try:
        st = os.stat(path)
        if st.st_dev in seen:
            continue
        seen.add(st.st_dev)
        u = shutil.disk_usage(path)
        disks.append({"name": label, "total_gb": round(u.total / 1e9, 1), "free_gb": round(u.free / 1e9, 1),
                      "used_percent": round(100 * u.used / u.total)})
    except Exception:
        pass
out["disks"] = disks
print(json.dumps(out))
