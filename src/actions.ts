// Every dashboard button is one of these: a fixed command on a fixed device.
// The confirm sheet shows the exact command before it runs, and it lands in
// History like anything typed by hand.

export type Tone = "normal" | "publish" | "caution";

export interface Action {
  label: string;
  deviceId: string;
  command: string;
  tone: Tone;
  /** One line for the confirm sheet: what happens if you say yes. */
  effect: string;
}

const PRECHECK = "bash ~/storage/shorts-poster/scripts/precheck_next.sh";
const safe = (s: string) => s.replace(/'/g, "’").replace(/[\r\n]+/g, " ").slice(0, 200);

export const piActions = {
  postYouTube: (): Action => ({
    label: "Post next Short to YouTube",
    deviceId: "pi",
    command: "curl -sS -m 900 -X POST http://127.0.0.1:7124/api/post_next",
    tone: "publish",
    effect: "Publishes the first fact-checked Short in the queue to @bytsyz1, publicly. Counts toward today's cap of 3.",
  }),
  crosspostInstagram: (): Action => ({
    label: "Cross-post latest Short to Instagram",
    deviceId: "pi",
    command: "bash ~/storage/ig-poster/crosspost_latest.sh --post",
    tone: "publish",
    effect: "Posts the Short that last went up on YouTube as a reel on @sahillchanna.ai. Skips it if it's already there; never retries a failure.",
  }),
  previewNext: (): Action => ({
    label: "Show the next Short",
    deviceId: "pi",
    command: `${PRECHECK} --check`,
    tone: "normal",
    effect: "Read-only: prints the title, script lines and sources of the Short that posts next.",
  }),
  hold: (jobId: string, reason: string): Action => ({
    label: "Hold this Short",
    deviceId: "pi",
    command: `${PRECHECK} --hold ${jobId} '${safe(reason) || "held from Harness"}'`,
    tone: "caution",
    effect: "Moves it out of the posting queue into .hold/. Release puts it back.",
  }),
  release: (jobId: string): Action => ({
    label: "Release this Short",
    deviceId: "pi",
    command: `${PRECHECK} --release ${jobId}`,
    tone: "caution",
    effect: "Puts a held Short back in the queue. It still needs Hermes' fact-check before it can post.",
  }),
  vouch: (jobId: string): Action => ({
    label: "Mark as fact-checked",
    deviceId: "pi",
    command: `${PRECHECK} --ok ${jobId}`,
    tone: "publish",
    effect: "Skips Hermes' fact-check: you are vouching for it, and it can post at the next slot.",
  }),
  runFactory: (): Action => ({
    label: "Make a new Short now",
    deviceId: "pi",
    command: "curl -sS -m 60 -X POST http://127.0.0.1:7123/api/run",
    tone: "normal",
    effect: "Starts the factory on the next topic. Takes a few minutes; the result lands in the queue unchecked.",
  }),
  linkedinDraft: (): Action => ({
    label: "Draft today's LinkedIn post",
    deviceId: "pi",
    command:
      "cd ~/storage/shorts-factory && set -a && . /mnt/phone_files/files/.agent_env && . ./nim.env && set +a && ./.venv/bin/python linkedin_run.py --config config.linkedin.yaml",
    tone: "normal",
    effect: "Writes a draft and sends it to Telegram for your approval. Nothing publishes without your tap there.",
  }),
  restart: (name: string, scope: string): Action => ({
    label: `Restart ${name}`,
    deviceId: "pi",
    command: `python3 -c "import sys, json; sys.path.insert(0, '/home/saxill/storage/zara-bridge'); import dash; print(json.dumps(dash.restart_service('${name}', '${scope}')))"`,
    tone: "caution",
    effect: `Restarts the ${scope} service ${name} and reports its new state.`,
  }),
};

export const hermesActions = {
  runJob: (id: string, name: string): Action => ({
    label: `Run “${name}” now`,
    deviceId: "channa",
    command: `$env:HERMES_HOME='D:\\hermes'; $env:PYTHONIOENCODING='utf-8'; & 'D:\\hermes\\bin\\hermes.exe' cron run ${id}`,
    tone: "caution",
    effect: "Tells Hermes to run this job on his next scheduler tick, exactly as if it were its scheduled time.",
  }),
};

/** Starter commands in the terminal, per OS. */
export const snippets: Record<string, { label: string; command: string }[]> = {
  linux: [
    { label: "Disk", command: "df -h / ~ 2>/dev/null" },
    { label: "Top processes", command: "ps -eo pid,user,%cpu,%mem,etime,comm --sort=-%cpu | head -12" },
    { label: "Failed services", command: "systemctl --failed --no-pager; systemctl --user --failed --no-pager" },
    { label: "Recent errors", command: "journalctl -p err --since '-1h' --no-pager | tail -30" },
    { label: "Tailscale", command: "tailscale status | head -10" },
  ],
  macos: [
    { label: "Disk", command: "df -h /" },
    { label: "Top processes", command: "ps -Ao pid,user,%cpu,%mem,etime,comm -r | head -12" },
    { label: "Battery", command: "pmset -g batt" },
    { label: "Tailscale", command: "/Applications/Tailscale.app/Contents/MacOS/Tailscale status | head -10" },
  ],
  windows: [
    { label: "Disk", command: "Get-PSDrive -PSProvider FileSystem | Format-Table Name,@{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}},@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}" },
    { label: "Top processes", command: "Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 Name,Id,CPU,@{n='MB';e={[int]($_.WS/1MB)}} | Format-Table" },
    { label: "Hermes jobs", command: "$env:HERMES_HOME='D:\\hermes'; & 'D:\\hermes\\bin\\hermes.exe' cron list" },
    { label: "Wi-Fi", command: "netsh wlan show interfaces" },
  ],
};
