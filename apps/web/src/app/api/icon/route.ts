import { eq } from "drizzle-orm";

import { createDb, serverInfo } from "@tapestopnight/core/db";

/** The row is read per request; freshness comes from the ETag, not a build. */
export const dynamic = "force-dynamic";

/**
 * Serve the Server Icon.
 *
 * `?v=64` returns the exact 64x64 PNG that Apply writes to disk - what a
 * player will actually see in their server list. Without it, the admin's
 * original high-resolution upload, which is what the public hero renders. That
 * split is the whole point of keeping two artifacts: a 64px image blown up
 * into a page banner looks broken, and a banner-sized PNG is silently ignored
 * by Minecraft.
 *
 * Bytes live in Postgres (ADR-0002 applied to a non-properties artifact), so
 * this route is the only way they reach a browser. Public and unauthenticated
 * on purpose: the icon is already broadcast to anyone who pings the server.
 */
export async function GET(request: Request) {
  const wants64 = new URL(request.url).searchParams.get("v") === "64";

  const { db, sql } = createDb();
  try {
    const rows = await db
      .select({
        source: serverInfo.iconSource,
        mime: serverInfo.iconSourceMime,
        sha: serverInfo.iconSourceSha256,
        icon64: serverInfo.icon64,
      })
      .from(serverInfo)
      .where(eq(serverInfo.id, 1))
      .limit(1);

    const row = rows[0];
    const bytes = wants64 ? row?.icon64 : row?.source;
    if (!row || !bytes || !row.sha) {
      // No icon uploaded yet. A 404 lets the caller render the designed empty
      // state rather than a broken image.
      return new Response("no icon", { status: 404, headers: { "cache-control": "no-store" } });
    }

    // Both variants derive from the same upload, so one digest identifies
    // both - suffixed so a browser cannot serve the 64px one as the original.
    const etag = `"${row.sha}${wants64 ? "-64" : ""}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": wants64 ? "image/png" : (row.mime ?? "application/octet-stream"),
        "content-length": String(bytes.byteLength),
        etag,
        // Revalidate every time, but the 304 above keeps that cheap. The icon
        // changes rarely and unpredictably; serving a stale one for an hour
        // after an admin uploads a new one is the wrong trade.
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  } finally {
    await sql.end();
  }
}
