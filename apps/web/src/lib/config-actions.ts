"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { configKey, configHistory, createDb, serverInfo } from "@tapestopnight/core/db";
import {
  IconError,
  applyDesiredConfig,
  assertIcon64,
  assertSource,
  sha256Hex,
  tierFor,
} from "@tapestopnight/core/config";

import { requireAdmin } from "./admin";

const PACK_DIR = process.env.PACK_DIR ?? "/pack";

/**
 * The history key for the Server Icon.
 *
 * Not a server.properties key - the icon is a file, not a property - but it is
 * still a config change an admin made, and the audit trail should be able to
 * answer "who changed the icon and when" alongside everything else.
 */
const ICON_HISTORY_KEY = "server-icon";

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Change one config value.
 *
 * The tier is re-checked HERE, not just in the UI. ADR-0007 makes a LOCKED key
 * unrenderable as an input, but that is a usability measure — a crafted POST
 * would sail past it. This is the check that actually holds the line, and it
 * reads the same TIERS table the UI reads so the two can never disagree.
 */
export async function setConfigValue(key: string, value: string): Promise<ActionResult> {
  const { discordId } = await requireAdmin();

  const rule = tierFor(key);
  if (rule.tier === "LOCKED") {
    return {
      ok: false,
      message: `คีย์ "${key}" ถูกล็อกไว้และแก้ผ่านเว็บไม่ได้ — ${rule.reason}`,
    };
  }

  const { db, sql } = createDb();
  try {
    const existing = await db
      .select({ value: configKey.value })
      .from(configKey)
      .where(eq(configKey.key, key))
      .limit(1);

    const before = existing[0]?.value;
    if (before === undefined) {
      return { ok: false, message: `ไม่พบคีย์ "${key}" ในฐานข้อมูล` };
    }
    if (before === value) {
      return { ok: true, message: "ค่าเดิมอยู่แล้ว ไม่มีอะไรเปลี่ยน" };
    }

    await db
      .update(configKey)
      .set({ value, updatedBy: discordId, updatedAt: new Date() })
      .where(eq(configKey.key, key));

    // Append-only trail. This is the thing a file on disk cannot give us
    // (ADR-0002): who changed the MOTD, when, and what it was before.
    await db.insert(configHistory).values({
      key,
      oldValue: before,
      newValue: value,
      changedBy: discordId,
    });

    revalidatePath("/config");
    return {
      ok: true,
      message: `บันทึก ${key} แล้ว — ยังไม่มีผลกับเซิร์ฟจนกด Apply`,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Upload the Server Icon.
 *
 * Two files arrive: the admin's source image, and the 64x64 PNG the browser
 * derived from it. Both are validated from their own bytes - the declared
 * Content-Type is never consulted - because the failure this feature exists to
 * prevent is silent: Minecraft ignores an icon that is not exactly 64x64,
 * without an error or a log line, so an unchecked upload looks like a success
 * forever.
 *
 * Storing is not applying. The icon reaches players only through Apply, which
 * restarts the Game Server, because Minecraft reads server-icon.png once at
 * process start.
 */
export async function uploadServerIcon(form: FormData): Promise<ActionResult> {
  const { discordId } = await requireAdmin();

  const source = form.get("source");
  const derived = form.get("icon64");
  if (!(source instanceof File) || !(derived instanceof File)) {
    return { ok: false, message: "ฟอร์มไม่ครบ — ต้องมีทั้งรูปต้นฉบับและไอคอน 64×64 ที่ย่อแล้ว" };
  }

  const sourceBytes = Buffer.from(await source.arrayBuffer());
  const icon64Bytes = Buffer.from(await derived.arrayBuffer());

  let measured;
  try {
    measured = assertSource(sourceBytes);
    assertIcon64(icon64Bytes);
  } catch (err) {
    // An IconError is a message written for the admin. Anything else is a bug
    // and should not be dressed up as user-facing advice.
    if (err instanceof IconError) return { ok: false, message: err.message };
    throw err;
  }

  const sha = sha256Hex(sourceBytes);

  const { db, sql } = createDb();
  try {
    const rows = await db
      .select({ sha: serverInfo.iconSourceSha256 })
      .from(serverInfo)
      .where(eq(serverInfo.id, 1))
      .limit(1);

    const before = rows[0];
    if (!before) {
      return { ok: false, message: "ไม่พบแถว server_info — ฐานข้อมูลยังไม่ได้ seed" };
    }
    if (before.sha === sha) {
      return { ok: true, message: "รูปเดิมอยู่แล้ว ไม่มีอะไรเปลี่ยน" };
    }

    await db
      .update(serverInfo)
      .set({
        iconSource: sourceBytes,
        iconSourceMime: measured.mime,
        iconSourceSha256: sha,
        icon64: icon64Bytes,
        iconUpdatedBy: discordId,
        iconUpdatedAt: new Date(),
      })
      .where(eq(serverInfo.id, 1));

    // The digest, not the image. History is a trail, not a gallery.
    await db.insert(configHistory).values({
      key: ICON_HISTORY_KEY,
      oldValue: before.sha,
      newValue: sha,
      changedBy: discordId,
    });

    revalidatePath("/config");
    revalidatePath("/");
    return {
      ok: true,
      message:
        `รับรูป ${measured.width}×${measured.height} แล้ว และย่อเป็น 64×64 เรียบร้อย — ` +
        `ยังไม่ถึงผู้เล่นจนกว่าจะกด Apply`,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Apply: render the Desired Config to disk and restart the Game Server.
 *
 * This is the ONLY path by which a config change reaches players (ADR-0002),
 * and it is restart-bearing, so it is deliberately a separate, explicit action
 * rather than something that happens on save.
 */
export async function applyConfig(): Promise<ActionResult> {
  const { discordId } = await requireAdmin();

  const baseUrl = process.env.DOCKER_PROXY_URL;
  const container = process.env.MC_CONTAINER_NAME;

  const { db, sql } = createDb();
  let outcome;
  try {
    // The mechanics live in core because the Discord bot performs the same
    // operation (ADR-0006). What stays here is authorisation, the Thai
    // wording, and cache revalidation - the parts that are the web app's.
    outcome = await applyDesiredConfig(db, {
      packDir: PACK_DIR,
      renderedBy: discordId,
      docker: baseUrl && container ? { baseUrl, container } : null,
    });
  } finally {
    await sql.end();
  }

  const iconNote = outcome.iconError ? ` (เขียนไอคอนไม่สำเร็จ: ${outcome.iconError})` : "";

  if (!outcome.ok) {
    return {
      ok: false,
      message:
        outcome.failedAt === "properties"
          ? `เขียนไฟล์ไม่สำเร็จ: ${outcome.error}`
          : `เขียนไฟล์แล้วแต่รีสตาร์ทไม่สำเร็จ: ${outcome.error} — ` +
            `ค่าใหม่จะมีผลเมื่อเซิร์ฟรีสตาร์ทครั้งถัดไป${iconNote}`,
    };
  }

  if (!outcome.restarted) {
    return {
      ok: true,
      message:
        "เขียน server.properties แล้ว แต่ยังไม่ได้ตั้งค่าการควบคุมคอนเทนเนอร์ " +
        "จึงรีสตาร์ทให้ไม่ได้ — ต้องรีสตาร์ทเองเพื่อให้ค่ามีผล" +
        iconNote,
    };
  }

  revalidatePath("/config");
  revalidatePath("/");
  return {
    ok: true,
    message:
      (outcome.wroteIcon
        ? "Apply สำเร็จ — เขียน server.properties กับ server-icon.png และสั่งรีสตาร์ทเซิร์ฟแล้ว"
        : "Apply สำเร็จ — เขียนไฟล์และสั่งรีสตาร์ทเซิร์ฟแล้ว") + iconNote,
  };
}
