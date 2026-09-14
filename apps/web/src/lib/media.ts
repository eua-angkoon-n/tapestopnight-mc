import { statSync } from "node:fs";
import { join } from "node:path";

/**
 * A URL for a file in /media that changes when the file does.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 *
 * /srv/mc/media is bind-mounted into the container and its files are replaced
 * in place, under names the page references directly. The origin serves them
 * with `Cache-Control: public, max-age=0`, which is correct — revalidate every
 * time, the bytes may have changed.
 *
 * Cloudflare does not pass that through. The apex is proxied (ADR-0001) and
 * Cloudflare rewrites the browser-facing header for static extensions to
 * `max-age=14400`. So a visitor is told to keep the image for four hours, and
 * an operator who replaces one sees the old picture with nothing on the Host
 * to explain it — the file is right, the app serves the right bytes, and the
 * browser never asks. Measured on 2026-09-14: origin said max-age=0, the
 * public URL said max-age=14400.
 *
 * Appending the file's mtime makes the URL change whenever the file does, so
 * the cached copy simply stops being the one the page asks for. Four hours of
 * caching then becomes a feature rather than a trap.
 *
 * This is the same move `/api/icon?h=<sha>` already makes for the Server Icon,
 * for the same reason.
 *
 * ── Why mtime and not a hash ──────────────────────────────────────────────
 *
 * The page is `force-dynamic`, so this runs per request, and hashing a 300 KB
 * image on every render to defeat a cache would cost more than the cache
 * saves. mtime answers the only question being asked — "is this the same file
 * as last time" — for the price of a stat.
 *
 * Falls back to the bare path if the file cannot be stat'd. A missing media
 * file should degrade to a broken image, which is visible, rather than to a
 * 500, which takes the whole page down.
 */
export function mediaUrl(file: string): string {
  // The standalone build runs with cwd=/app and the mount at
  // /app/apps/web/public/media; `next dev` from apps/ sees public/media.
  const candidates = [
    join(process.cwd(), "apps", "web", "public", "media", file),
    join(process.cwd(), "public", "media", file),
  ];

  for (const path of candidates) {
    try {
      return `/media/${file}?v=${Math.floor(statSync(path).mtimeMs)}`;
    } catch {
      // Try the next layout before giving up.
    }
  }
  return `/media/${file}`;
}
