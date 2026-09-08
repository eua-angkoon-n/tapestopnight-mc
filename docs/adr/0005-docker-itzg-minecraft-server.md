# Game Server runs as a Docker container on `itzg/minecraft-server`

Of the Linux options we chose Docker via `itzg/minecraft-server` (`TYPE=FORGE`,
`VERSION=1.12.2`, `FORGE_VERSION=14.23.5.2860`):

- **It solves Java 8.** The image ships the correct JRE. Java 8 is increasingly awkward on
  current Ubuntu/Debian and does not exist on the user's machine either.
- It runs the Forge installer itself, which this pack requires (no bundled forge jar).
- Postgres joins the same compose file, as the user suggested.
- **Explicit `mem_limit` / `cpus` per container** — decisive, because the Host also runs the
  ledger system and must not be starved by a 6 GB JVM.
- One declarative deployment that coexists with the ledger app.

**⚠️ Conflicts with ADR-0002:** the itzg image normally generates `server.properties` itself
from env vars on every start, which would erase the DB-rendered file each boot.
**`SKIP_SERVER_PROPERTIES=true` is mandatory**, and no `server.properties`-shaped env vars may
be set on that container. Our renderer owns the file exclusively.

**⚠️ Security consequence:** the control plane needs Docker access to start/stop the container,
and mounting `/var/run/docker.sock` is equivalent to root on a Host that also runs the ledger
system. Mitigation: a `docker-socket-proxy` sidecar scoped to
`POST /containers/{mc}/{start,stop,restart}` and container inspect only — never the raw socket.

**⚠️ Lifecycle tuning forced by the modpack:** because `max-tick-time=-1` makes multi-minute
apparent hangs *normal* during OTG generation, the container gets **no Docker healthcheck**
and a generous `stop_grace_period` (several minutes) so saving a large OTG world is never cut
short.
