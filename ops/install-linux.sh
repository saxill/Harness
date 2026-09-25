#!/usr/bin/env bash
# Installs a built Harness on a Linux desktop for the current user, plus the
# 21:30 pipeline digest timer. Build first: npm ci && npx tauri build --no-bundle
set -euo pipefail
cd "$(dirname "$0")/.."
bin=src-tauri/target/release/harness
[ -x "$bin" ] || { echo "no build at $bin; run: npm ci && npx tauri build --no-bundle" >&2; exit 1; }

install -Dm755 "$bin" ~/.local/bin/harness
install -Dm644 src-tauri/icons/128x128.png ~/.local/share/icons/hicolor/128x128/apps/harness.png
install -Dm644 src-tauri/icons/icon.png ~/.local/share/icons/hicolor/512x512/apps/harness.png
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/harness.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=Harness
Comment=Dashboard, terminals and agent for the Mac, channa, the Pi and this laptop
Exec=$HOME/.local/bin/harness
Icon=harness
Terminal=false
Categories=Development;System;
StartupWMClass=harness
DESKTOP
update-desktop-database ~/.local/share/applications 2>/dev/null || true

unit=~/.config/systemd/user
mkdir -p "$unit"
cat > "$unit/harness-digest.service" <<UNIT
[Unit]
Description=Harness daily pipeline digest into the Obsidian vault
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $PWD/ops/digest/digest.py
UNIT
cat > "$unit/harness-digest.timer" <<UNIT
[Unit]
Description=Harness daily pipeline digest at 21:30

[Timer]
OnCalendar=*-*-* 21:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now harness-digest.timer
echo "installed: ~/.local/bin/harness, Harness launcher entry, harness-digest.timer"
