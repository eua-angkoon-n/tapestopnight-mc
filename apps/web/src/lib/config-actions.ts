"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { configKey, configHistory, createDb } from "@tapestopnight/core/db";
import { renderFromDb, tierFor } from "@tapestopnight/core/config";
import { restart } from "@tapestopnight/core/control";
import { writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { requireAdmin } from "./admin";

const PACK_DIR = process.env.PACK_DIR ?? "/pack";

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
 * Apply: render the Desired Config to disk and restart the Game Server.
 *
 * This is the ONLY path by which a config change reaches players (ADR-0002),
 * and it is restart-bearing, so it is deliberately a separate, explicit action
 * rather than something that happens on save.
 */
export async function applyConfig(): Promise<ActionResult> {
  const { discordId } = await requireAdmin();

  const { db, sql } = createDb();
  let rendered: string;
  try {
    rendered = await renderFromDb(db, {
      renderedAt: new Date().toISOString(),
      renderedBy: discordId,
    });
  } finally {
    await sql.end();
  }

  const target = join(PACK_DIR, "server.properties");
  try {
    // Write to a temp file and rename. A crash midway through a direct write
    // would leave the server with a truncated server.properties, and it starts
    // by reading exactly this file.
    const tmp = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(tmp, rendered, "utf8");
    await rename(tmp, target);
  } catch (err) {
    return {
      ok: false,
      message: `เขียนไฟล์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const baseUrl = process.env.DOCKER_PROXY_URL;
  const container = process.env.MC_CONTAINER_NAME;
  if (!baseUrl || !container) {
    return {
      ok: true,
      message:
        "เขียน server.properties แล้ว แต่ยังไม่ได้ตั้งค่าการควบคุมคอนเทนเนอร์ " +
        "จึงรีสตาร์ทให้ไม่ได้ — ต้องรีสตาร์ทเองเพื่อให้ค่ามีผล",
    };
  }

  try {
    // 600 s, matching stop_grace_period. A large OTG world genuinely takes
    // minutes to save and cutting that short is how worlds corrupt.
    await restart({ baseUrl, container }, 600);
  } catch (err) {
    return {
      ok: false,
      message:
        `เขียนไฟล์แล้วแต่รีสตาร์ทไม่สำเร็จ: ` +
        `${err instanceof Error ? err.message : String(err)} — ` +
        `ค่าใหม่จะมีผลเมื่อเซิร์ฟรีสตาร์ทครั้งถัดไป`,
    };
  }

  revalidatePath("/config");
  revalidatePath("/");
  return { ok: true, message: "Apply สำเร็จ — เขียนไฟล์และสั่งรีสตาร์ทเซิร์ฟแล้ว" };
}
