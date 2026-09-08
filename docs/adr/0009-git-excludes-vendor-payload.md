# Git holds source and intent, never vendor payload or generated artifacts

The Modpack is 822 MB unpacked — `mods/` alone is **565 MB across 206 jars**, and `config/`
is **47.4 MB across 1,945 files** shipped by the pack author. Committing that would make every
clone slow forever (git cannot delta-compress jars — they are already deflated) and would bury
our few real changes under a 1,945-file vendor diff on every pack upgrade.

**The Modpack payload stays out of git.** The repo records the exact version (`v1.1.2b`) and
the **SHA256 of the server-pack zip**; the zip itself lives in the user's own off-box storage,
and the deploy script fetches from there and verifies the hash before unpacking. The hash is
what matters: mod version drift is the single most common cause of "my client can't join", and
a recorded digest turns that from guesswork into a check.

**Pack `config/` and `scripts/` are tracked as an overlay, not a vendor copy.** Git holds only
`overlay/config/**` and `overlay/scripts/**` — the handful of files we deliberately change.
Deploy = unpack the verified zip, then copy the overlay over it. `git log overlay/` is then a
precise, readable history of *what we customised and why*, and a pack upgrade to v1.1.3 is
just "unpack the new zip, reapply the overlay" with upstream conflicts surfacing naturally.

**A drift-check script closes the overlay's blind spot.** An overlay cannot see a config
someone hand-edits directly on the Host. So a script compares the Host's live `config/` and
`scripts/` against (verified zip + overlay) and reports every mismatch. This is the same
discipline ADR-0002 already demands for `server.properties`, extended to mod configs.

**Client-only files are never deployed at all.** The "server pack" ships `shaderpacks/` (3.7
MB), `resourcepacks/` (16.9 MB), `options.txt`, `optionsof.txt` and `optionsshaders.txt` —
OptiFine and shader settings a dedicated server never reads. They are excluded from the Host
entirely. (`resources/` at 135.8 MB and `structures/` at 12.1 MB need per-mod checking; some
1.12.2 mods do read those server-side.)

```
tapestopnight-mc/
├── apps/
│   ├── web/                    Next.js — public pages + admin UI
│   └── bot/                    discord.js — slash-command tree
├── packages/
│   └── core/                   auth · config · control (ADR-0006)
├── overlay/
│   ├── config/                 ONLY the pack configs we changed
│   └── scripts/                ONLY the CraftTweaker scripts we changed
├── db/
│   ├── migrations/
│   └── seed/config-keys.ts     the ADR-0003 tier table — policy, so it is source
├── deploy/
│   ├── docker-compose.yml      env references only, no literal secrets
│   ├── Dockerfile.web
│   ├── Dockerfile.bot
│   ├── modpack.lock            version + SHA256 + source URL (ADR-0009)
│   ├── fetch-modpack.sh        download, verify hash, unpack, drop client-only files
│   └── check-drift.sh          live Host config vs (zip + overlay)
├── docs/adr/0001-…-0010-….md
├── CONTEXT.md
├── .env.example                every key present, every value empty
├── .gitleaks.toml
├── .gitignore
└── README.md                   the runbook
```

`.gitignore` must cover, at minimum: `.env`, `*.pem`, `id_ed25519*`, `node_modules/`,
`.next/`, and — importantly — **`server.properties`**, `DregoraRL/`, `world*/`, `logs/`,
`crash-reports/`, `backups/`, and the uploaded Server Icon originals. `server.properties` is
gitignored *deliberately*: it is an ADR-0002 build artifact, and committing it would invite
exactly the hand-editing ADR-0002 forbids.
