/**
 * The Status Poller.
 *
 * The ONLY thing that probes the Game Server for status. Everything else — the
 * public pages, the bot's /server status — reads the cache row it writes. If
 * each web request probed directly, fifty concurrent visitors would mean fifty
 * probes; this way the Game Server sees constant load no matter how many people
 * are watching.
 *
 * Making it a separate process is deliberate. It makes "only one prober" a
 * structural fact rather than a convention someone can break later by adding a
 * ping to a page handler.
 */
import { sql as raw } from "drizzle-orm";

import { createDb, serverStatusCache } from "@tapestopnight/core/db";
import { inspect, readStatus, tcpProbe } from "@tapestopnight/core/control";

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const MC_HOST = process.env.MC_SLP_HOST ?? "mc";
const MC_PORT = Number(process.env.MC_SLP_PORT ?? 25565);
const DOCKER_URL = process.env.DOCKER_PROXY_URL ?? "";
const CONTAINER = process.env.MC_CONTAINER_NAME ?? "mc";

const { db, sql } = createDb();

function log(...parts: unknown[]) {
  console.log(new Date().toISOString(), ...parts);
}

async function containerState() {
  if (!DOCKER_URL) return null;
  try {
    return await inspect({ baseUrl: DOCKER_URL, container: CONTAINER });
  } catch (err) {
    log("docker inspect failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function tick() {
  const [status, state] = await Promise.all([
    readStatus({ host: MC_HOST, port: MC_PORT }),
    containerState(),
  ]);

  // ADR-0012 runs the JVM close to the cgroup limit, which makes an OOM kill
  // the failure mode to expect. Untracked it would read as a mystery crash.
  if (state?.oomKilled) {
    log("!! CONTAINER WAS OOM-KILLED — see ADR-0012; the heap or mem_limit is wrong");
  }

  // Three states, not two. "busy" is a server that failed to answer a ping but
  // is demonstrably alive — and it must never be reported as offline.
  let verdict: "online" | "busy" | "offline" = status.online ? "online" : "offline";

  // Narrow on status.online, not a local: TypeScript needs the discriminant
  // itself to know `status` is the offline variant and carries `.error`.
  if (!status.online) {
    // A ping timeout does NOT mean down. max-tick-time=-1 is mandatory for this
    // pack because OTG structure generation legitimately blocks the main thread
    // for minutes, and that is indistinguishable from a dead server over SLP.
    // So the verdict needs corroboration: the container must be gone, or the
    // port must be refusing connections.
    const listening = await tcpProbe(MC_HOST, MC_PORT);
    const running = state?.running ?? listening;
    if (running && listening) {
      verdict = "busy";
    }
  }
  const online = verdict !== "offline";

  await db
    .insert(serverStatusCache)
    .values({
      id: 1,
      online,
      playersOnline: status.online ? status.playersOnline : null,
      playersMax: status.online ? status.playersMax : null,
      sample: status.online ? status.sample : null,
      motd: status.online ? status.motd : null,
      lastSeenOnline: status.online ? new Date() : null,
      containerState: state?.status ?? null,
      probedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: serverStatusCache.id,
      set: {
        online: raw`excluded.online`,
        playersOnline: raw`excluded.players_online`,
        playersMax: raw`excluded.players_max`,
        sample: raw`excluded.sample`,
        motd: raw`excluded.motd`,
        containerState: raw`excluded.container_state`,
        probedAt: raw`excluded.probed_at`,
        // COALESCE, not overwrite: the public page says "last seen 2 hours ago"
        // when the server is down, which needs the old value to survive.
        lastSeenOnline: raw`coalesce(excluded.last_seen_online, ${serverStatusCache.lastSeenOnline})`,
      },
    });

  // Log the VERDICT, not the raw ping result. Logging `status.online` here
  // printed "OFFLINE" on the very ticks where the system had correctly decided
  // the server was merely busy — telemetry that contradicts the decision it is
  // reporting on is worse than none, because an operator acts on it.
  if (verdict === "online" && status.online) {
    log(
      `online ${status.playersOnline}/${status.playersMax}`,
      `${status.latencyMs}ms`,
      `proto=${status.protocol}`,
      status.sample.length ? `[${status.sample.join(", ")}]` : "",
    );
  } else if (verdict === "busy") {
    log(
      `BUSY container=${state?.status ?? "unknown"} — ping failed but ${MC_PORT} ` +
        `accepts TCP, so this is very likely OTG generating chunks. Reported as ` +
        `online. (${status.online ? "" : status.error})`,
    );
  } else {
    log(
      `OFFLINE container=${state?.status ?? "unknown"} ` +
        `(${status.online ? "unexpected" : status.error})`,
    );
  }
}

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`${signal} — shutting down`);
    stopping = true;
  });
}

log(`poller starting: ${MC_HOST}:${MC_PORT} every ${INTERVAL_MS}ms`);
while (!stopping) {
  try {
    await tick();
  } catch (err) {
    // Never exit on a transient failure: if the poller dies the whole site
    // goes stale, and restart storms make it worse.
    log("tick failed:", err instanceof Error ? err.message : err);
  }
  if (!stopping) await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

await sql.end();
log("stopped");
