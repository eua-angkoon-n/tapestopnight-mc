<#
  PreToolUse guard for the tapestopnight Host.

  Claude Code pipes the tool-call payload to this script on stdin as JSON. We
  read `.tool_input.command` -- the raw command text, before any shell sees it --
  and decide whether it may run.

  Why a hook and not just `permissions.deny`: a Bash deny rule matches the
  invocation Claude usually produces and is explicitly NOT a security boundary
  around the program. `Bash(docker stop family-ledger*)` does not stop
  `/usr/bin/docker stop ...`, `bash -c '...'`, `docker -H ... stop ...`, or
  `docker compose -f /opt/family-ledger/docker-compose.yml down`. This script
  sees the whole string, so it catches all of those.

  Two verdicts:
    BLOCK -> reason on stderr, exit 2. Exit 2 is deliberate: it stops the call
             BEFORE permission rules are evaluated, so it holds even against an
             allow rule. There is no way for the model to talk past it.
    ASK   -> `permissionDecision: ask` JSON on stdout, exit 0. Used where the
             capability must survive but the operator must look at it first.

  Anything else: exit 0 silently, and the normal permission flow applies.
#>

$ErrorActionPreference = 'Stop'

# A guard that crashes must not become a guard that is off. Any unexpected
# failure below falls through to a BLOCK, never to an allow.
try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json
    $cmd     = [string]$payload.tool_input.command
    if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }
}
catch {
    [Console]::Error.WriteLine("guard.ps1 could not read the tool payload, so the command is blocked rather than waved through. Error: $($_.Exception.Message)")
    exit 2
}

function Deny([string]$reason) {
    [Console]::Error.WriteLine("BLOCKED by .claude/hooks/guard.ps1`n`n$reason")
    exit 2
}

function Ask([string]$reason) {
    # Must start with { and end with } or Claude Code ignores it silently.
    $out = @{
        hookSpecificOutput = @{
            hookEventName          = 'PreToolUse'
            permissionDecision     = 'ask'
            permissionDecisionReason = $reason
        }
    } | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.Write($out)
    exit 0
}

# ── 1. The ledger system. Absolute. ──────────────────────────────────
#
# /opt/family-ledger is a pre-existing system on a Host we only rent part of.
# Nothing here has any business touching it, so the match is deliberately wide:
# the compose project name, the container names, and the path all trip it.
if ($cmd -imatch 'family[-_]ledger' -or $cmd -imatch '/opt/family[-_]ledger') {
    Deny @"
This command names the family-ledger system, which is off limits.

  matched in: $cmd

/opt/family-ledger and the containers family-ledger-app-1 / family-ledger-db-1
belong to a separate system on this Host. Read it, stop it, restart it, inspect
it - none of those. If you need to know whether the Host as a whole is under
memory or disk pressure, measure the Host in aggregate (free -m, df -h,
docker stats with no container named) and never single this project out.
"@
}

# ── 2. Raw SSH to the Host. ──────────────────────────────────────────
#
# Not because SSH is dangerous, but because the vps-read / vps-do split is how
# the permission layer tells a diagnosis from a change. A raw ssh call routes
# around that distinction, so it is refused and the wrapper named instead.
$HostIp = '217.216.111.122'
if ($cmd -imatch '(^|[\s;&|(`''"])(ssh|scp|sftp)(\.exe)?\s' -and
    ($cmd -match [regex]::Escape($HostIp) -or $cmd -imatch 'root@')) {
    Deny @"
Raw ssh/scp to the Host bypasses the read/write split.

  matched in: $cmd

Use the wrappers instead - they are what the permission rules recognise:

  .claude/bin/vps-read.sh '<command>'   # diagnosis; runs without prompting
  .claude/bin/vps-do.sh   '<command>'   # any change; always asks first

If what you want really is a file copy, say so and the operator can run scp by
hand.
"@
}

# ── 3. The secrets file. ─────────────────────────────────────────────
#
# /srv/mc/repo/deploy/.env holds RCON_PASSWORD, POSTGRES_PASSWORD, AUTH_SECRET
# and the Discord bot token. Reading it puts every one of them in a transcript
# that is kept. There is no diagnosis that needs the values themselves.
if ($cmd -imatch 'deploy/\.env(\s|$|['']"])' -and
    $cmd -inotmatch '\.env\.example') {
    Deny @"
That reads deploy/.env, which holds every secret this system has.

  matched in: $cmd

RCON_PASSWORD, POSTGRES_PASSWORD, AUTH_SECRET and DISCORD_BOT_TOKEN would all
land in the transcript. To check whether a variable is SET without printing it:

  .claude/bin/vps-read.sh 'grep -c ^RCON_PASSWORD= /srv/mc/repo/deploy/.env'

deploy/.env.example is fine to read - it is committed and has no values.
"@
}

# ── 4. Stopping the Game Server the naive way. ───────────────────────
#
# Not blocked, because sometimes it is genuinely the right call - but never
# without a look. README rule 3: a server that appears hung for five minutes is
# normal, because max-tick-time=-1 is mandatory for this pack and OTG structure
# generation legitimately blocks the main thread. stop_grace_period is 10m for
# the same reason: a large OTG world takes minutes to write, and cutting that
# short is how region files corrupt.
if ($cmd -imatch '\b(stop|kill|rm|restart|down)\b' -and
    $cmd -imatch 'tapestopnight-mc|tapestopnight_mc') {
    Ask @"
This stops or restarts the Game Server. Before approving, confirm all three:

  1. No pre-generation is running.
     .claude/bin/vps-read.sh 'docker exec tapestopnight-mc rcon-cli "pregen info ShowTaskList"'
  2. RCON answers. If it does not, you do not know what state the world is in,
     and an unresponsive RCON is NOT evidence the server is down - OTG can block
     the main thread for minutes (README rule 3, ADR-0005).
  3. A world backup exists that you would accept losing back to.
     .claude/bin/vps-read.sh 'ls -la /srv/mc/backups/world | tail -3'

The world takes minutes to save. If the grace period expires mid-write, region
files corrupt. Prefer /server restart from the Discord bot, which gives players
a 30-second countdown.
"@
}

# ── 5. Building on the Host. ─────────────────────────────────────────
#
# ADR-0010. A Next.js build peaks at 1-2 GB beside a 7 GB JVM, and the OOM
# killer picks the biggest process - which is the game server, with players on
# it. Images are built in CI and pushed to GHCR; the Host only ever pulls.
if ($cmd -imatch 'docker\s+(compose\s+)?build' -or $cmd -imatch 'docker\s+compose[^|;]*\bbuild\b') {
    Deny @"
Never build on the Host (ADR-0010).

  matched in: $cmd

A Next.js build peaks at 1-2 GB of RSS next to a 7 GB JVM. The OOM killer picks
the largest process, which is the Game Server, with players connected. Images
are built in CI and pushed to GHCR; the Host only pulls:

  .claude/bin/vps-do.sh 'cd /srv/mc/repo/deploy && docker compose pull && docker compose up -d'

If you are building locally on this laptop rather than on the Host, run it from
the repo root without the Host wrapper and this rule will not fire.
"@
}

exit 0
