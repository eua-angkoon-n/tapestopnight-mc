---
status: accepted
note: premises updated for Homestead — see "What the move to Homestead changed"
---

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


## What the move to Homestead changed

Every concrete value in this ADR was a Dregora value. The **choice** of
`itzg/minecraft-server` survives the pack change; the arguments for it do not, and one of them
inverts:

| | Dregora | Homestead |
|---|---|---|
| tag | `itzg/minecraft-server:java8` | `:java17` |
| `TYPE` | `FORGE` | `FABRIC` |
| `VERSION` | `1.12.2` | `1.20.1` |
| loader pin | `FORGE_VERSION` | `FABRIC_LOADER_VERSION` |

- **"It solves Java 8" is now "it solves Java 17"** — the same argument, and still the main one:
  the image ships the right JRE, and getting the right JRE onto a box by hand is how a runtime
  ends up undocumented. 17 rather than 21 because the pack's own `variables.txt` says
  `RECOMMENDED_JAVA_VERSION=17`; see ADR-0018.
- **It runs the loader's own installer**, which is why the pack directory can hold a server pack
  that does not bundle a launcher.
- `SKIP_SERVER_PROPERTIES: "true"` is **unchanged and still mandatory** (ADR-0002). No
  server.properties-shaped env var may be added to this service, on any loader.
- The socket-proxy argument is unchanged.

**The no-healthcheck decision stands, but not for the reason written above.** That reason was
OpenTerrainGenerator, which Homestead does not contain. The conclusion outlives it: first boot
of a 374-mod pack exceeds the image's 120s start period outright, and Homestead builds terrain
through Tectonic and TerraBlender, which still stalls long enough to fail a 30s probe under
load. What a healthcheck buys is an automatic restart; what it costs is that restart arriving
mid chunk-write. That trade was bad on Dregora and it is bad here. `max-tick-time=-1` and
`stop_grace_period: 10m` stay for the same reason.

Do not read the disappearance of OTG as having retired the rule. → CLAUDE.md, prohibition 1.

The heap and GC flags moved too, and needed more than a value change — the Java 8 GC flags were
*removed* in JDK 16 and would have stopped the container booting at all. → ADR-0018.
