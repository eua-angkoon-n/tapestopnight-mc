import { isStale, loadPublicData, thaiAgo } from "@/lib/data";

/** Never cached: this endpoint exists precisely to defeat caching. */
export const dynamic = "force-dynamic";

/**
 * The fragment LiveStatus polls every 30 seconds.
 *
 * Reads the Status Poller's cache row. It does not touch the Game Server, so a
 * hundred browsers polling this costs the Game Server nothing.
 */
export async function GET() {
  const { status } = await loadPublicData();
  return Response.json(
    {
      online: status.online,
      playersOnline: status.playersOnline,
      playersMax: status.playersMax,
      sample: [...status.sample],
      lastSeenAgo: thaiAgo(status.lastSeenOnline),
      stale: isStale(status.probedAt),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
