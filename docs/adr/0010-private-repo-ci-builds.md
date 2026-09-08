# Private repo; images built in CI so the Host never compiles beside the JVM

**Private.** The repo describes the deployment topology, the reverse-proxy layout, the admin
route structure and every mod version — of a box that also runs the `ledger` system. None of
that is individually secret, but together it is a map. And a leaked `.env` in a private repo
is recoverable (rotate, rewrite history); in a public one it is scraped by bots within minutes
and the history is permanent.

**`gitleaks` runs as a pre-commit hook regardless.** This is proportionate to an observed, not
hypothetical, risk profile: this very project's prior art has **hardcoded MySQL credentials in
source** (`controller.py` lines 21–40) and **Discord 2FA backup codes in a plaintext file**.

**Images are built in GitHub Actions and pushed to GHCR; the Host only runs
`docker compose pull && up -d`.** The reason is a specific failure mode, not tidiness: a
Next.js production build peaks around **1–2 GB RAM**. Running that on the Host means starting
a 2 GB process beside a JVM already holding 6 GB, while players are connected. If host memory
is exhausted the Linux OOM killer selects by score, which skews toward the **largest consumer
— the Minecraft JVM**. Players would be dropped mid-session with nothing in the game logs
explaining why. The `mem_limit` from ADR-0005 reduces this (the container is bounded by its own
cgroup) but does **not** make it immune to being the victim of a host-wide OOM.

Building off-box keeps the Host's peak memory flat and predictable, keeps build CPU away from
tick time, and makes rollback a matter of pulling a previous image tag.
