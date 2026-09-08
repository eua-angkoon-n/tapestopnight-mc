# Architecture Decision Records

Each file records one decision: what the context was, what we chose, and why. They exist so a
future reader does not have to guess — especially where the code looks wrong on purpose.

| # | Decision |
|---|---|
| [0001](./0001-srv-record-dns.md) | Minecraft reached via SRV, so the apex stays Cloudflare-proxied |
| [0002](./0002-postgres-source-of-truth.md) | Postgres is the source of truth; `server.properties` is a build artifact |
| [0003](./0003-config-edit-tiers.md) | Config keys carry an Edit Tier; unknown keys default to LOCKED |
| [0004](./0004-discord-guild-roles-authority.md) | Discord guild roles are the single authority for "who is an admin" |
| [0005](./0005-docker-itzg-minecraft-server.md) | Game Server runs as a Docker container on `itzg/minecraft-server` |
| [0006](./0006-typescript-monorepo.md) | One TypeScript monorepo: Next.js web + discord.js bot, shared core |
| [0007](./0007-design-system.md) | Dark Fantasy tokens, Thai-first typography, structural Edit Tiers |
| [0008](./0008-reuse-discord-application.md) | Reuse the DISCO NIGHT Discord application; retire it and Prominence control |
| [0009](./0009-git-excludes-vendor-payload.md) | Git holds source and intent, never vendor payload or generated artifacts |
| [0010](./0010-private-repo-ci-builds.md) | Private repo; images built in CI so the Host never compiles beside the JVM |
| [0011](./0011-4gb-heap-on-8gb-host.md) | ~~Run at `-Xmx4G` on an 8 GB Host~~ — **superseded by 0012** |
| [0012](./0012-8gb-heap-on-measured-12gb-host.md) | Run at `-Xmx8G` on the measured 12 GB Host |

Three of these (0006, 0008, 0012) record a choice made **against** a recommendation. They say so, and
they state the case for the option that was chosen — not the one that was rejected.

ADR-0011 is superseded and kept unedited. It was decided on a premise that measurement later
disproved; deleting it would hide that, and the next person deserves to see a wrong premise
get corrected rather than a history where every call was right.

Measured facts about the Host live in [`docs/host-inventory.md`](../host-inventory.md), not in
an ADR — they are observations, not decisions.
