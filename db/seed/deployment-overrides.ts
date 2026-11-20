/**
 * The handful of keys where the pack's own value is wrong for THIS deployment.
 *
 * The seed's rule is that values come from the modpack's `server.properties`,
 * so the seeded config is byte-for-byte what the pack author shipped and
 * tested. That rule is right and stays. These are the documented exceptions to
 * it, held in one reviewed list rather than hand-edited into the generated SQL
 * afterwards — a generated file somebody has edited is a generated file that is
 * about to be regenerated over.
 *
 * Each entry needs a reason that is about **this Host**, not about taste. If
 * the argument for an override is "I prefer it", it belongs in the admin panel
 * as a FREE or GUARDED key instead, which is what those tiers are for.
 *
 * These are seeded values, not locks. `level-name` and `enable-rcon` are LOCKED
 * by `tiers.ts` and cannot be changed from any surface; `max-tick-time` is too.
 * The override decides what the row STARTS as; the tier decides who may move it.
 */

export interface Override {
  readonly value: string;
  readonly why: string;
}

export const DEPLOYMENT_OVERRIDES: Readonly<Record<string, Override>> = {
  /*
    The pack ships no server.properties, so the server writes vanilla's
    `max-tick-time=60000` — one minute.

    On this Host any finite value is a loaded gun. Generating chunks
    through TerraBlender, Regions Unexplored and a dozen structure mods legitimately
    blocks the main thread for minutes, and the watchdog's response is to kill the server — during
    worldgen, which is when region files are half-written. This is prohibition
    1 in CLAUDE.md and it is the single most expensive value in this file.
  */
  "max-tick-time": {
    value: "-1",
    why: "watchdog must not fire during chunk generation (CLAUDE.md prohibition 1, ADR-0005)",
  },

  /*
    Vanilla's default is `enable-rcon=false`, which is the right default for someone
    running this at home and completely wrong here.

    RCON is how the Control Plane exists at all: the bot's /players list, every
    restart countdown, the Chat Bridge's writes, and the save-all flush before a
    backup. With it false, Apply's own precondition check refuses to write
    anything (apply.ts) and the bot answers nothing. The password comes from the
    environment, never from a row — see SECRET_KEYS in render.ts.
  */
  "enable-rcon": {
    value: "true",
    why: "the Control Plane speaks to the Game Server over RCON and nothing else (ADR-0002)",
  },

  /*
    Vanilla's default is `level-name=world`.

    Naming the world after the pack is what makes `/srv/mc/pack` legible: the
    previous packs' worlds were `DregoraRL`, `Homestead`, `atm10sky` and `reveries`, and one glance said which pack the
    directory on disk belonged to. It also has to agree with MC_WORLD_DIR in
    docker-compose.yml and LEVEL_NAME in backup.sh, which is why it is pinned
    here rather than left to whatever the next pack happens to default to.
  */
  "level-name": {
    value: "prominence",
    why: "the world directory should name the pack; must match MC_WORLD_DIR and backup.sh",
  },

  /*
    Vanilla's default is `allow-flight=false`, and every pack before this one
    shipped a file that said true.

    With it false the server kicks anyone airborne for five seconds "for
    flying" — which in Prominence II is a player on a Mythic Mount, in an Ad
    Astra jet suit or under an elytra, playing normally. The tier is LOCKED
    with exactly that reason, so the seeded value has to be the one the lock
    describes; a LOCKED row seeded false could not be corrected from any
    surface.

    (The `online-mode` override that stood here left with The Casket of
    Reveries, which shipped it false. Vanilla's default is true.)
  */
  "allow-flight": {
    value: "true",
    why: "modded flight (mounts, jet suits, elytra) is normal play; vanilla's false kicks for it",
  },
};

/** The pack's value, unless this deployment has a reasoned exception. */
export function seededValue(key: string, packValue: string): string {
  return DEPLOYMENT_OVERRIDES[key]?.value ?? packValue;
}
