#!/usr/bin/env bash
# Pairs the Linux laptop's Obsidian vault with the Pi over Syncthing, Tailscale
# only (no global discovery, no relays). Run from any machine that can SSH to
# both. Needs syncthing installed on the laptop: sudo pacman -S --needed syncthing
#
# Pi:     home ~/storage/syncthing (off the SD card), folder ~/storage/vault
#         (already set up, with 30-day staggered versioning)
# Laptop: default home, folder ~/Documents/saxil-obsidian/saxil
set -euo pipefail
PI=saxill@100.90.23.49
PI_IP=100.90.23.49
LAPTOP=saxill@100.120.253.10
LAPTOP_IP=100.120.253.10
FOLDER=saxil-vault
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)

"${SSH[@]}" $LAPTOP 'command -v syncthing >/dev/null' </dev/null \
  || { echo "syncthing isn't installed on the laptop: sudo pacman -S --needed syncthing" >&2; exit 1; }

echo "== laptop: start syncthing"
LAPTOP_ID=$("${SSH[@]}" $LAPTOP "bash -s" <<'EOF'
set -e
export STNODEFAULTFOLDER=1
systemctl --user enable --now syncthing >/dev/null 2>&1
for i in $(seq 1 20); do syncthing cli show system >/dev/null 2>&1 && break; sleep 1; done
syncthing cli show system | python3 -c 'import json,sys; print(json.load(sys.stdin)["myID"])'
EOF
)
PI_ID=$("${SSH[@]}" $PI 'syncthing cli --home=$HOME/storage/syncthing show system' </dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["myID"])')
echo "laptop $LAPTOP_ID"
echo "pi     $PI_ID"

echo "== laptop: Tailscale only, add the Pi, share the vault"
"${SSH[@]}" $LAPTOP "bash -s" <<EOF
set -e
C="syncthing cli"
\$C config options global-ann-enabled set false
\$C config options local-ann-enabled set false
\$C config options relays-enabled set false
\$C config options natenabled set false
\$C config options uraccepted set -- -1
# a fresh config listens on "default" (all interfaces); swap it for the Tailscale IP
\$C config options raw-listen-addresses 0 set "tcp://$LAPTOP_IP:22000"
\$C config devices list | grep -q "$PI_ID" \
  || \$C config devices add --device-id "$PI_ID" --name pi --addresses "tcp://$PI_IP:22000"
V=\$HOME/Documents/saxil-obsidian/saxil
printf '// Obsidian UI state changes constantly and is per-device\n.obsidian/workspace*.json\n.trash\n*.harness-tmp\n' > "\$V/.stignore"
\$C config folders list | grep -qx $FOLDER \
  || \$C config folders add --id $FOLDER --label "saxil vault" --path "\$V"
\$C config folders $FOLDER devices list | grep -q "$PI_ID" \
  || \$C config folders $FOLDER devices add --device-id "$PI_ID"
EOF

echo "== pi: add the laptop and share the vault with it"
"${SSH[@]}" $PI "bash -s" <<EOF
set -e
C="syncthing cli --home=\$HOME/storage/syncthing"
\$C config devices list | grep -q "$LAPTOP_ID" \
  || \$C config devices add --device-id "$LAPTOP_ID" --name laptop --addresses "tcp://$LAPTOP_IP:22000"
\$C config folders $FOLDER devices list | grep -q "$LAPTOP_ID" \
  || \$C config folders $FOLDER devices add --device-id "$LAPTOP_ID"
EOF

echo "== waiting for the first sync"
for i in $(seq 1 60); do
  out=$("${SSH[@]}" $PI "syncthing cli --home=\$HOME/storage/syncthing show connections" </dev/null \
    | python3 -c "import json,sys; c=json.load(sys.stdin)['connections'].get('$LAPTOP_ID',{}); print('up' if c.get('connected') else 'down')")
  [ "$out" = up ] && break
  sleep 2
done
echo "connection: $out"
"${SSH[@]}" $PI 'sleep 10; find ~/storage/vault -name "*.md" | wc -l | xargs echo "notes on the Pi:"' </dev/null
