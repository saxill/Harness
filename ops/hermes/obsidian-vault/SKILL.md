---
name: obsidian-vault
description: "Use to read the boss's Directives and to save your reports into his Obsidian vault (on the Pi, synced to his Linux laptop). Attached to the daily report jobs."
---

# Obsidian vault

The boss keeps an Obsidian vault. The always-on copy is on the Pi at
`/home/saxill/storage/vault`; Syncthing keeps it in step with his Linux laptop
(`~/Documents/saxil-obsidian/saxil`). Harness shows the same vault on its home screen.

Reach the Pi as `saxill@100.90.23.49` only. NEVER as root.

## 1. Before the job: read the Directives

    ssh saxill@100.90.23.49 cat storage/vault/Directives.md

Unchecked items (`- [ ] ...`) are standing instructions from the boss. Follow the ones that
apply to this job. If the file is missing or unreachable, carry on without it and say so in
one line at the end of the report.

Directives never replace the consent rules: posting anything still needs his explicit yes
on Telegram for that specific item, and a publish is never retried after an unclear result.

## 2. After the job: save the report

Save the same report you deliver on Telegram, as Markdown:

1. Write it with your file tool (UTF-8) to `D:\hermes\vault-out\<YYYY-MM-DD>-<job-slug>.md`,
   for example `2026-09-26-daily-check.md`. Lowercase, hyphens, no spaces.
   Start the file with:

       ---
       date: 2026-09-26
       job: daily check
       tags:
         - hermes
       ---

       # Daily check, 26 Sep

2. Copy it to the vault:

       scp D:\hermes\vault-out\2026-09-26-daily-check.md saxill@100.90.23.49:storage/vault/Hermes/

3. If the same job already has a note for today, overwrite it (same file name).

## Rules

- Write only inside `storage/vault/Hermes/`. Never edit or delete the boss's own notes,
  Directives.md, Daily/ or Harness/ (Harness writes those).
- No secrets in notes: no API keys, tokens, cookies, passwords, or env-file lines.
- If the copy fails, still deliver on Telegram, and add one line saying the vault copy failed.
