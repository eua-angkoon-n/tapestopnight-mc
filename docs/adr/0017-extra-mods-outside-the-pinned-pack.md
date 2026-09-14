---
status: accepted
note: mechanism unchanged; the list is empty since Homestead — see the tail
---

> **The mechanism stands; its one entry is gone.** Homestead bundles Simple Voice Chat among
> its 374 mods, so `extra-mods.lock` is now empty. Everything below about *how* a mod outside
> the pack is pinned, verified and backed out is unchanged and still binding. See "Homestead
> makes this file empty, not obsolete" at the end.

# Mods may be added outside the pinned pack, pinned separately — and the first one is Simple Voice Chat

Players asked to talk to each other in game with proximity audio. There is no
way to do that without a mod on every client that wants to hear anything, so
the question was never "mod or no mod" — it was which mod, and what adding one
does to the guarantee `modpack.lock` currently makes.

## The invariant this changes

Until now the Game Server's `mods/` was exactly what came out of the archive
whose SHA256 is in `deploy/modpack.lock`. From here it is **the archive, plus
`deploy/extra-mods.lock`**. That is a real weakening and it gets its own file
rather than a line in a script, with the same rule: verify the hash before
anything lands where Forge will load it.

Rebuilding the zip to include the mod was the alternative. It was rejected: the
zip is **upstream's**. Forking RLCraft Dregora onto a hash nobody else can
verify would mean re-forking on every pack update, forever, to carry one jar.

## Simple Voice Chat 1.12.2-2.6.23, and why this one

Everything below was read out of the jar, not off a web page.

| | |
|---|---|
| Java bytecode | class major **52 = Java 8**, matching `JAVA_MAJOR=8` |
| `acceptedMinecraftVersions` | `[1.12.2]` |
| **`acceptableRemoteVersions`** | **`"*"`** — on `voicechat` and `voicechat_api` both |
| Default port | `24454`, UDP |
| Config | `config/voicechat/voicechat-server.properties` |
| Natives | `linux-x64` present (opus, rnnoise, speex, lame) |
| Published | 2026-09-04 |

**`acceptableRemoteVersions="*"` is the deciding fact.** `fetch-modpack.sh`
already warns that Forge 1.12.2 does a mod-list handshake on connect and kicks
a client whose list differs — which is why nothing is ever removed from
`mods/`. Adding to it has the same hazard in reverse, and `"*"` is what removes
it: **a player without the mod still joins and plays exactly as before, with no
voice.** Nobody is locked out of a server they were playing on yesterday
because of a feature they did not ask for.

The corollary, which is worse than it sounds: a player on a *different*
version also connects fine, and then SVC's own protocol check refuses their
audio. They are in the game, hearing silence, with no error to search for. So
the runbook gives a link to one exact version rather than the mod's name.

`force_voice_chat` must stay `false` — its whole purpose is to reject clients
without the mod, which would throw away the property this decision rests on.

## The failure that leaves no trace anywhere: `voice_host`

Players type `tapestopnight.com`. That name is **Cloudflare-proxied** (A and
AAAA); only the SRV target `mc.tapestopnight.com` is DNS-only and reaches this
Host (ADR-0001). Cloudflare does not carry Minecraft's UDP.

So if the client derives its voice destination from the name that was typed
rather than from the socket it actually ended up on, every packet is sent into
Cloudflare and dropped — nothing in the server log, nothing in the client log,
nothing anywhere. A working-looking server where nobody can hear anyone.

`voice_host=mc.tapestopnight.com:24454` is set explicitly in the overlay rather
than reasoned about. One line, and the question stops existing. Verification is
`tcpdump -ni any udp port 24454` while somebody talks: packets from the
player's real address, or it is this.

## Two doors, both have to be open

`docker compose` publishes `24454:24454/udp` — **the `/udp` suffix is not
optional.** Without it Docker publishes TCP, the mod binds UDP, and every tool
that checks reports the port as open while voice silently fails.

The Host's ufw carried only 22, 80, 443 and 25565/tcp, so `ufw allow 24454/udp`
is the second door.

## Memory, and a stated back-out threshold

ADR-0012 runs a 7 GB heap measured at 7.765 GiB RSS against a hard `mem_limit`
of 10g. The mod's natives and its per-client UDP buffers are **off-heap**, and
the cgroup counts them. `oom_score_adj: -500` biases the kernel's OOM killer
away from this container but does nothing at all about hitting `mem_limit`,
which kills it outright, with players connected.

With `max-players=8` the expected delta is tens of megabytes. Expected is not
measured, and ADR-0012 was itself revised after measurement — so:

**If RSS passes 9.3 GiB (93% of the limit), remove the jar and restart.**
`deploy/fetch-extra-mods.sh --remove` exists so that back-out is one command
rather than a half-remembered filename.

## Consequences

- `check-drift.sh` compares only `config` and `scripts`, so a jar in `mods/` is
  invisible to it — but `config/voicechat-server.properties` is not. Re-accept
  the baseline after the first boot.
- The overlay carries the **whole rendered config**, of which exactly two
  values are ours. A two-key overlay would work — the mod fills in what is
  missing — but disk would then differ from the overlay forever and
  `--vs-pack` would report it every time. Reviewing that file is reviewing the
  effective config.
- **The config path was got wrong on the first attempt, and it is worth saying
  how.** The path was assembled from two strings found separately in the jar's
  constant pool, `"config"` and `"voicechat-server.properties"`, joined without
  the modid segment that sits between them. The mod ignored the resulting file
  and wrote its own with defaults — so `voice_host` was blank, which is exactly
  the silent failure it exists to prevent, on a server that otherwise looked
  fully deployed. `check-drift.sh` is what caught it, by reporting BOTH files
  as added. Reading a path out of bytecode is a guess until something on disk
  agrees with it.
- `fetch-modpack.sh --force` unpacks with `unzip -o` and never clears `mods/`,
  so these jars **survive a pack upgrade** — including one to a Minecraft
  version they do not support, where a stale jar simply stops the server
  booting. `fetch-extra-mods.sh` refuses to run when `extra-mods.lock` and
  `modpack.lock` disagree about the Minecraft version, and says so by name.
- CurseForge and Modrinth ship this mod under **different hashes**: the builds
  differ only in `META-INF/MANIFEST.MF` (CurseForge's is one byte longer), with
  all 1,633 entries identically named and `mcmod.info` and
  `ForgeVoicechatMod.class` byte-identical. The lock pins the source the script
  actually downloads from. Players may use either link — what has to match
  between them and the server is the version string, not the file hash.


## Homestead makes this file empty, not obsolete

Simple Voice Chat ships **inside** Homestead. Pinning a second copy here would put two
voicechat jars in `mods/`, and Fabric refuses to start on a duplicate mod id — so the entry is
removed rather than re-pinned for 1.20.1.

An empty `EXTRA_MODS` is a truthful answer to "which mods are on this server, beyond the
archive", not an absent one. `fetch-extra-mods.sh` says so explicitly rather than printing
"all extra mods present and pinned" over a list of none.

**What does not go away with the jar:**

- `overlay/config/voicechat/voicechat-server.properties` still carries the two settings that are
  ours — `voice_host` and `force_voice_chat`. The pack supplies the mod; we still supply the
  configuration, and the `voicechat/` subdirectory still matters (a file one level up is
  silently ignored).
- `voice_host=mc.tapestopnight.com:24454`, because the apex is Cloudflare-proxied and does not
  carry UDP (ADR-0001). Unchanged.
- `force_voice_chat=false`. Unchanged, and still the thing not to flip: it throws away the
  property that lets a player without the mod join at all.
- `24454:24454/udp` in compose, and `ufw allow 24454/udp` on the Host. Two doors, both still
  open, neither touched by the pack change.

**What does go away:** the runbook line telling players to install one exact jar version.
Everyone who installs Homestead has the mod, at the version the pack pins, which is what that
instruction was trying to achieve by hand.

### The trap this file warned about, which then happened

The ⚠ above says every entry must be re-checked against `MINECRAFT_VERSION` on a pack upgrade,
because `fetch-modpack.sh --force` unpacks with `unzip -o` and never clears `mods/`. The guard
in `fetch-extra-mods.sh` implements that and would have fired.

It has one blind spot, now written into the script: if the lock is **emptied in the same change
that upgrades the pack** — exactly what this migration did — there is no entry left to compare,
so `--remove` has nothing to remove and the stale 1.12.2 jar would survive into a 1.20.1
`mods/` and stop the server booting. Deleting the pack directory outright is what actually
clears it, which is why the cutover removes `/srv/mc/pack` rather than unpacking over it.
