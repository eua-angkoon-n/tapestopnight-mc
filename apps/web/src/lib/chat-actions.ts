"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { chatMessage, createDb } from "@tapestopnight/core/db";
import {
  autoLinkByIp,
  issueLinkCode,
  linkedNameFor,
  sanitizeBody,
} from "@tapestopnight/core/bridge";

import { auth } from "@/auth";

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * A floor under how fast one account can talk.
 *
 * In memory, in this process, deliberately. There is one web container; a
 * Postgres round trip per keystroke-ish message to enforce a limit that exists
 * to stop someone scrolling the in-game chat off the screen would cost more
 * than the thing it prevents. It resets on deploy, which is fine — a deploy is
 * not something an abuser can trigger.
 */
const RATE_WINDOW_MS = 30_000;
const RATE_MAX = 10;
const recent = new Map<string, number[]>();

function overRate(discordId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(discordId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    recent.set(discordId, hits);
    return true;
  }
  hits.push(now);
  recent.set(discordId, hits);
  return false;
}

/**
 * The visitor's real address.
 *
 * Read from ONE header, and one this app does not trust the internet to set:
 * Caddy is configured to overwrite `X-Real-Client-IP` with its own
 * `{client_ip}` on every proxied request (deploy/caddy/Caddyfile), which in
 * turn comes from `CF-Connecting-IP` only because Cloudflare's ranges are
 * listed as trusted proxies there.
 *
 * The naive version of this — take the first entry of `X-Forwarded-For` — is
 * a hole, not a shortcut: that value is whatever the client sent, so anyone
 * could claim any address and be handed the matching player's identity.
 *
 * Returns null when the header is absent, and every caller treats that as "no
 * match" rather than falling back to something less trustworthy.
 */
async function clientIp(): Promise<string | null> {
  const value = (await headers()).get("x-real-client-ip");
  return value?.trim() || null;
}

/** The Minecraft name of whoever is signed in, or null. Render decisions only. */
export async function viewerLinkedName(): Promise<string | null> {
  const session = await auth();
  if (!session?.discordId) return null;

  const { db, sql } = createDb();
  try {
    return await linkedNameFor(db, session.discordId);
  } finally {
    await sql.end();
  }
}

/**
 * Try to work out which player this is from the address they are browsing from.
 *
 * → ADR-0016. Succeeds when the browser and the game came from the same
 * address; falls back to a code otherwise, which is not an edge case — a
 * household with two players, or a phone on mobile data, lands there normally.
 */
export async function linkAccount(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.discordId) return { ok: false, message: "ต้องล็อกอิน Discord ก่อน" };

  const ip = await clientIp();
  const { db, sql } = createDb();
  try {
    if (ip) {
      const result = await autoLinkByIp(db, { discordId: session.discordId, ip });
      switch (result.status) {
        case "linked":
        case "already":
          revalidatePath("/chat");
          return { ok: true, message: `ผูกกับผู้เล่น ${result.mcName} แล้ว` };
        case "taken":
          return {
            ok: false,
            message: `ผู้เล่น ${result.mcName} ถูกผูกกับบัญชี Discord อื่นไปแล้ว`,
          };
        // "ambiguous" and "no-match" fall through to the code below. Both mean
        // the address cannot answer the question, and guessing is the one thing
        // this must not do.
      }
    }

    const code = await issueLinkCode(db, session.discordId);
    return {
      ok: false,
      message:
        `ระบุตัวจากไอพีไม่ได้ — เข้าเกมแล้วพิมพ์ในแชท:  !link ${code}  ` +
        `(โค้ดใช้ได้ 15 นาที) แล้วกลับมากดปุ่มนี้อีกครั้ง`,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Say something in game from the website.
 *
 * Writes a row and stops. The bot drains it to the Game Server over RCON —
 * this must never open an RCON connection itself, because `max-tick-time=-1`
 * lets OTG block the server's main thread for minutes and the visitor would
 * watch a request hang with no way to tell that from a broken site.
 *
 * Being linked is re-checked HERE and not only in the page that renders the
 * box, for the same reason `requireAdmin` exists: the rendered UI decides what
 * to show, this decides what may be done.
 */
export async function sendChat(raw: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.discordId) return { ok: false, message: "ต้องล็อกอิน Discord ก่อน" };

  const body = sanitizeBody(raw);
  if (!body) return { ok: false, message: "พิมพ์ข้อความก่อน" };

  if (overRate(session.discordId)) {
    return { ok: false, message: "พิมพ์เร็วเกินไป — รอสักครู่แล้วลองใหม่" };
  }

  const { db, sql } = createDb();
  try {
    const mcName = await linkedNameFor(db, session.discordId);
    if (!mcName) {
      return { ok: false, message: "ต้องผูกบัญชีกับผู้เล่นในเกมก่อนถึงจะพิมพ์ได้" };
    }

    await db.insert(chatMessage).values({
      source: "web",
      authorName: mcName,
      authorDiscordId: session.discordId,
      body,
    });
    return { ok: true, message: "" };
  } finally {
    await sql.end();
  }
}
