import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { eq } from "drizzle-orm";

import { serverInfo, type Database } from "../db/index.ts";
import { restart, type DockerOptions } from "../control/docker.ts";
import { parseProperties, renderFromDb } from "./render.ts";

/**
 * Apply - the only path by which a config change reaches players (ADR-0002).
 *
 * This lives in core rather than in the web app because the Discord bot
 * performs the same operation, and ADR-0006's whole argument is that logic
 * both surfaces depend on must exist once. Two copies of "render, write,
 * restart" would drift, and the thing they would drift about is the file the
 * Game Server reads at boot and the moment every connected player is kicked.
 *
 * What stays OUT of here: authorisation, Thai user-facing wording, cache
 * revalidation, and the in-game countdown. Those are surface concerns. This
 * function assumes the caller already established the right to call it.
 */

export interface ApplyOptions {
  /** Where the Game Server reads its files. `/pack` in both containers. */
  readonly packDir: string;
  /** Discord id, stamped into the generated header so the file names its author. */
  readonly renderedBy: string;
  /**
   * Omit to render and write without restarting. The caller then owns telling
   * the operator that the change is on disk but not yet live.
   */
  readonly docker?: DockerOptions | null;
  /**
   * Matches stop_grace_period. A large OTG world genuinely takes minutes to
   * save, and cutting that short is how worlds corrupt.
   */
  readonly restartTimeoutSeconds?: number;
  /**
   * Values injected into the rendered file that are NOT stored in Postgres.
   *
   * Currently just `rcon.password`. ADR-0003 displays locked keys with their
   * values on the admin page, so a stored RCON password would be printed to
   * every admin; it comes from the environment instead. See SECRET_KEYS.
   */
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface ApplyOutcome {
  readonly ok: boolean;
  /**
   * Which stage failed, so a caller can word the message correctly rather
   * than inferring it. Inferring is a trap: "no icon was written" means both
   * "the icon write failed" and "there is no icon", and those need different
   * sentences.
   */
  readonly failedAt: "precondition" | "properties" | "restart" | null;
  readonly wroteProperties: boolean;
  readonly wroteIcon: boolean;
  readonly restarted: boolean;
  /** Set when the icon failed but the Apply carried on regardless. */
  readonly iconError: string | null;
  /** Set when properties could not be written, or the restart failed. */
  readonly error: string | null;
}

/**
 * Write a file the way Apply must: to a temp path, then rename.
 *
 * A crash midway through a direct write leaves the Game Server with a
 * truncated file, and it reads both of these at process start. rename() within
 * one filesystem is atomic, so a reader sees either the old file or the new
 * one and never a half-written one.
 */
export async function writeAtomically(
  target: string,
  data: string | Uint8Array,
): Promise<void> {
  const tmp = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(tmp, data);
  await rename(tmp, target);
}

export async function applyDesiredConfig(
  db: Database,
  opts: ApplyOptions,
): Promise<ApplyOutcome> {
  const secrets = opts.secrets ?? {};
  const rendered = await renderFromDb(
    db,
    { renderedAt: new Date().toISOString(), renderedBy: opts.renderedBy },
    secrets,
  );

  /*
    Refuse to write a file that would turn RCON off by omission.

    Minecraft ignores enable-rcon=true when rcon.password is empty. It starts
    fine, plays fine, and RCON is simply absent — no error, no log line worth
    noticing. That is precisely how this went unnoticed for five phases: the
    bot's /players list and the in-game restart countdown both need RCON, and
    both would fail in ways that read as "the server is busy".

    Failing here is loud and costs nothing: nothing has been written yet.
  */
  const wantsRcon = parseProperties(rendered).get("enable-rcon") === "true";
  if (wantsRcon && !secrets["rcon.password"]) {
    return {
      ok: false,
      failedAt: "precondition",
      wroteProperties: false,
      wroteIcon: false,
      restarted: false,
      iconError: null,
      /*
        Name BOTH places, because the first version of this message named only
        deploy/.env and that is usually the wrong one. The value was present
        there all along; what was missing was passing it through to this
        container. Sending someone to re-check a file that is already correct
        is the same failure the auth check made — a refusal that blames the
        wrong thing costs more than no message.
      */
      error:
        "enable-rcon is true but no rcon.password reached the renderer — Minecraft " +
        "would silently start with RCON disabled. Check BOTH: that RCON_PASSWORD is " +
        "set in deploy/.env, AND that this service declares it under `environment:` " +
        "in deploy/docker-compose.yml. It being in .env is not enough on its own.",
    };
  }

  const iconRows = await db
    .select({ icon64: serverInfo.icon64 })
    .from(serverInfo)
    .where(eq(serverInfo.id, 1))
    .limit(1);
  const icon64 = iconRows[0]?.icon64 ?? null;

  try {
    await writeAtomically(join(opts.packDir, "server.properties"), rendered);
  } catch (err) {
    // Nothing has changed on disk and nothing has been restarted. Stop here.
    return {
      ok: false,
      failedAt: "properties",
      wroteProperties: false,
      wroteIcon: false,
      restarted: false,
      iconError: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  /*
    The icon is materialised here, but failing to write it does NOT fail the
    Apply. server.properties is already on disk and the restart below is what
    makes it real; aborting now to spare a decoration would leave the config
    half applied. Report it and continue.
  */
  let wroteIcon = false;
  let iconError: string | null = null;
  if (icon64) {
    try {
      await writeAtomically(join(opts.packDir, "server-icon.png"), icon64);
      wroteIcon = true;
    } catch (err) {
      iconError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!opts.docker) {
    return {
      ok: true,
      failedAt: null,
      wroteProperties: true,
      wroteIcon,
      restarted: false,
      iconError,
      error: null,
    };
  }

  try {
    await restart(opts.docker, opts.restartTimeoutSeconds ?? 600);
  } catch (err) {
    return {
      ok: false,
      failedAt: "restart",
      wroteProperties: true,
      wroteIcon,
      restarted: false,
      iconError,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    failedAt: null,
    wroteProperties: true,
    wroteIcon,
    restarted: true,
    iconError,
    error: null,
  };
}
