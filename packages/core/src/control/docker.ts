import { connect } from "node:net";

/**
 * Start, stop and inspect the Game Server container.
 *
 * Talks to a docker-socket-proxy over plain HTTP, never to /var/run/docker.sock
 * directly. Mounting the raw socket is equivalent to root on a Host that also
 * runs the ledger system (ADR-0005); the proxy is scoped to container inspect
 * plus start/stop/restart and nothing else.
 *
 * Deliberately no `dockerode` dependency — four endpoints do not justify one,
 * and every megabyte of resident memory is budgeted (ADR-0012).
 */

export interface DockerOptions {
  /** e.g. http://docker-socket-proxy:2375 */
  readonly baseUrl: string;
  readonly container: string;
  readonly timeoutMs?: number;
}

export interface ContainerState {
  /** created | running | paused | restarting | removing | exited | dead */
  readonly status: string;
  readonly running: boolean;
  readonly startedAt: string | null;
  readonly exitCode: number | null;
  readonly oomKilled: boolean;
}

async function call(
  opts: DockerOptions,
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  const res = await fetch(`${opts.baseUrl}/v1.43/containers/${opts.container}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs ?? opts.timeoutMs ?? 15_000),
  });
  // 304 means "already in that state" for start/stop — not a failure.
  if (!res.ok && res.status !== 304) {
    throw new Error(`docker ${path} -> ${res.status} ${await res.text().catch(() => "")}`.trim());
  }
  return res;
}

export async function inspect(opts: DockerOptions): Promise<ContainerState> {
  const res = await call(opts, "/json");
  const body = (await res.json()) as {
    State: {
      Status: string;
      Running: boolean;
      StartedAt: string;
      ExitCode: number;
      OOMKilled: boolean;
    };
  };
  return {
    status: body.State.Status,
    running: body.State.Running,
    startedAt: body.State.StartedAt ?? null,
    exitCode: body.State.ExitCode ?? null,
    // Worth surfacing loudly: ADR-0012 runs the JVM close enough to the cgroup
    // limit that an OOM kill is the failure mode to expect, and it would
    // otherwise look like an unexplained crash.
    oomKilled: body.State.OOMKilled ?? false,
  };
}

export async function start(opts: DockerOptions): Promise<void> {
  await call(opts, "/start", { method: "POST" });
}

/**
 * Stop the container, giving the server time to save.
 *
 * The image's entrypoint turns SIGTERM into an RCON `stop`, so this is a
 * graceful save. `stop_grace_period` in the compose file is 10 minutes because
 * a large world genuinely takes minutes to write; the default 10 seconds
 * would cut the save short. `t` here must not be smaller than that intent.
 */
export async function stop(opts: DockerOptions, timeoutSeconds = 600): Promise<void> {
  // The HTTP call has to outlive the shutdown it is waiting for, so its own
  // deadline is the container's grace period plus a minute of slack.
  await call(opts, `/stop?t=${timeoutSeconds}`, { method: "POST" }, (timeoutSeconds + 60) * 1000);
}

export async function restart(opts: DockerOptions, timeoutSeconds = 600): Promise<void> {
  await call(opts, `/restart?t=${timeoutSeconds}`, { method: "POST" }, (timeoutSeconds + 60) * 1000);
}

/**
 * Is anything accepting TCP on the game port?
 *
 * Half of the "is it down" verdict. The other half is the container state. We
 * never conclude "offline" from a Server List Ping timeout, because
 * `max-tick-time=-1` makes multi-minute stalls a normal part of chunk generation
 * and a stalled server looks identical to a dead one over SLP.
 */
export function tcpProbe(host: string, port: number, timeoutMs = 5_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
