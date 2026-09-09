import { createHash } from "node:crypto";

/**
 * Kept apart from icon.ts on purpose.
 *
 * icon.ts holds the size limits and the header parsers, and the browser-side
 * upload island needs those constants so its checks cannot drift from the
 * server's. Importing node:crypto from that module would make it unimportable
 * from client code, so the one function that needs Node lives here instead.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
