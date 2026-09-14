# Architecture Decision Records

Each file records one decision: what the context was, what we chose, and why. They exist so a
future reader does not have to guess — especially where the code looks wrong on purpose.

| # | Decision |
|---|---|
| [0001](./0001-srv-record-dns.md) | Minecraft reached via SRV, so the apex stays Cloudflare-proxied |
| [0002](./0002-postgres-source-of-truth.md) | Postgres is the source of truth; `server.properties` is a build artifact |
| [0003](./0003-config-edit-tiers.md) | Config keys carry an Edit Tier; unknown keys default to LOCKED |
| [0004](./0004-discord-guild-roles-authority.md) | Discord guild roles are the single authority for "who is an admin" |
| [0005](./0005-docker-itzg-minecraft-server.md) | Game Server runs as a Docker container on `itzg/minecraft-server` — premises updated for Fabric/Java 17 |
| [0006](./0006-typescript-monorepo.md) | One TypeScript monorepo: Next.js web + discord.js bot, shared core |
| [0007](./0007-design-system.md) | ~~Dark Fantasy tokens~~ — **superseded by 0019** (typography and tier rules carried forward) |
| [0008](./0008-reuse-discord-application.md) | Reuse the DISCO NIGHT Discord application; retire it and Prominence control |
| [0009](./0009-git-excludes-vendor-payload.md) | Git holds source and intent, never vendor payload or generated artifacts |
| [0010](./0010-private-repo-ci-builds.md) | Private repo; images built in CI so the Host never compiles beside the JVM |
| [0011](./0011-4gb-heap-on-8gb-host.md) | ~~Run at `-Xmx4G` on an 8 GB Host~~ — **superseded by 0012** |
| [0012](./0012-heap-size-on-measured-host.md) | ~~Run at `-Xmx7G` on the measured 12 GB Host~~ — **superseded by 0018** |
| [0013](./0013-server-icon-in-postgres-resized-in-browser.md) | Server Icon bytes live in Postgres, and the resize happens in the browser |
| [0014](./0014-bot-authorisation-surface.md) | The bot's authorisation surface: admin tiers, a fail-closed channel allowlist, GUARDED as `confirm: True` |
| [0015](./0015-chat-bridge-via-log-tail.md) | The Chat Bridge tails the log and writes over RCON; ~~milestones come from Better Questing~~ — that half **superseded by 0020** |
| [0016](./0016-ip-account-linking.md) | Accounts link by IP address, with a typed code as the path many players will actually use |
| [0017](./0017-extra-mods-outside-the-pinned-pack.md) | Mods may be added outside the pinned pack, pinned separately — the list is empty since Homestead bundles Simple Voice Chat |
| [0018](./0018-heap-on-fabric-java17.md) | Run at `-Xmx8G` on Java 17, with a measurement gate instead of a measurement |
| [0019](./0019-cozy-design-system.md) | Cozy light tokens, Thai-first typography, structural Edit Tiers |
| [0020](./0020-milestones-from-advancements.md) | Milestones come from the world's advancement files, not Better Questing |
| [0021](./0021-branch-protection-without-github-pro.md) | `main` protected by a checked-in ruleset plus a local hook, because a private repo on a free plan cannot be protected |

Three of these (0006, 0008, 0018) record a choice made **against** a recommendation. They say so, and
they state the case for the option that was chosen — not the one that was rejected.

ADR-0011 and ADR-0012 are superseded and kept unedited. 0011 was decided on a premise that
measurement later disproved. 0012's measurements were correct — for Forge 1.12.2 on Java 8, a
runtime this server no longer uses. Deleting either would hide that, and the next person
deserves to see a wrong premise corrected, and a right answer expiring, rather than a history
where every call was right.

**0018 is the one to watch.** It is the only ADR here that records a decision taken *without*
the measurement it needed, and it carries a table that is not filled in yet. Until somebody
writes a measured RSS into it, `-Xmx8G` is provisional.

Measured facts about the Host live in [`docs/host-inventory.md`](../host-inventory.md), not in
an ADR — they are observations, not decisions.
