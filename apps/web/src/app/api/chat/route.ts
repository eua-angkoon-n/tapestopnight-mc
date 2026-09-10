import { asc, desc, gt } from "drizzle-orm";

import { chatMessage, createDb } from "@tapestopnight/core/db";

/** Never cached: this endpoint exists precisely to defeat caching. */
export const dynamic = "force-dynamic";

/** One screenful. Enough to arrive mid-conversation and follow it. */
const PAGE = 50;

export interface ChatLine {
  id: number;
  source: "game" | "web" | "discord";
  author: string;
  body: string;
  at: string;
}

/**
 * The feed ChatPanel polls.
 *
 * Deliberately **public and unauthenticated**, matching /api/status: reading is
 * open to anyone, and only posting requires a signed-in, linked account. Nothing
 * here is private — every line was said out loud in a game server's public chat
 * or in a Discord channel.
 *
 * `?after=<id>` returns only what is newer, so a browser that has been sitting
 * on this page for an hour is not re-sent the whole window every three seconds.
 * Without it the response is the last page, which is what a fresh load wants.
 */
export async function GET(request: Request) {
  const after = Number(new URL(request.url).searchParams.get("after") ?? "");
  const { db, sql } = createDb();

  try {
    const incremental = Number.isInteger(after) && after > 0;

    const query = db
      .select({
        id: chatMessage.id,
        source: chatMessage.source,
        author: chatMessage.authorName,
        body: chatMessage.body,
        at: chatMessage.createdAt,
      })
      .from(chatMessage);

    /*
      Two different questions, and getting them the same way is a bug worth
      naming: "what is new since id N" is the oldest rows after N, but "what
      should a fresh page show" is the NEWEST rows, not the first fifty
      messages ever said. So the catch-up query orders descending and the
      result is reversed back into reading order.
    */
    const rows = incremental
      ? await query.where(gt(chatMessage.id, after)).orderBy(asc(chatMessage.id)).limit(PAGE)
      : (await query.orderBy(desc(chatMessage.id)).limit(PAGE)).reverse();

    const lines: ChatLine[] = rows.map((r) => ({
      id: r.id,
      source: r.source,
      author: r.author,
      body: r.body,
      at: r.at.toISOString(),
    }));

    return Response.json({ lines }, { headers: { "cache-control": "no-store" } });
  } finally {
    await sql.end();
  }
}
