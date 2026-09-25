# ops

Machine-side pieces that go with Harness.

- `install-linux.sh`: install a built Harness on a Linux desktop (binary, launcher entry) plus
  the digest timer. Build first with `npm ci && npx tauri build --no-bundle`.
- `digest/`: the 21:30 pipeline digest. `digest.py` runs on the Linux laptop, asks the Pi
  (`pi_side.py`) what the Shorts / Instagram / LinkedIn pipelines did that day, and writes a
  Pipelines section into the vault's `Daily/<date>.md`. `digest.py --print` for a dry run.
- `vault-sync.sh`: pair the laptop's Obsidian vault with the Pi over Syncthing (Tailscale only).
  The Pi side lives in `~/storage/syncthing` with the folder at `~/storage/vault`.
- `hermes/obsidian-vault/SKILL.md`: copy of the Hermes skill on channa
  (`D:\hermes\skills\obsidian-vault`), attached to the daily check, shorts-channel-analysis,
  linkedin-watch and shorts-watch jobs. `laya_triage.py` on channa writes its shortlist to the
  vault itself.
