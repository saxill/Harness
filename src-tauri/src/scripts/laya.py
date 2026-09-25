# Calls Laya on the machine it runs on. The bearer key is read from the
# systemd unit here and never leaves this machine. PAYLOAD is prepended.
import os, re, urllib.request
unit = os.path.expanduser("~/.config/systemd/user/laya-serve.service")
key, port = "", "8765"
for line in open(unit):
    if line.startswith("Environment=LAYA_API_KEY="):
        key = line.split("=", 2)[2].strip()
dropin = os.path.expanduser("~/.config/systemd/user/laya-serve.service.d/port.conf")
if os.path.exists(dropin):
    for line in open(dropin):
        m = re.match(r"Environment=LAYA_PORT=(\d+)", line.strip())
        if m:
            port = m.group(1)
req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/systemone", data=PAYLOAD,
                             headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
print(urllib.request.urlopen(req, timeout=25).read().decode())
