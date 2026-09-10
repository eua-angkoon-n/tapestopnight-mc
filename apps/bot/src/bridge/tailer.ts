/**
 * Reading the Game Server log as it is written.
 *
 * ── Why the file and not `docker logs` ────────────────────────────────────
 *
 * The container's stdout stream carries ANSI escapes from the pack's own
 * colouring — measured on the Host, lines arrive as `> [K[10:13:35] …` and
 * `[33;1m[11:11:40] …`. The file on disk is clean, and the bot already has
 * `/srv/mc/pack` mounted for Apply, so reading it costs no new privilege.
 *
 * ── Rotation ──────────────────────────────────────────────────────────────
 *
 * `latest.log` is replaced (not appended to) on every server restart and at
 * midnight, with the old content gzipped beside it. A reader holding an offset
 * into the old file would then sit at a byte position past the end of a new,
 * shorter one and go permanently silent — the failure mode being that nothing
 * errors, chat simply stops. Both signals are checked every tick: an inode
 * change means the file was replaced, and a size below the offset means it was
 * truncated. Either reopens at zero.
 *
 * ── Starting position ─────────────────────────────────────────────────────
 *
 * A fresh start seeks to the END. Replaying the existing file would push hours
 * of old conversation into Discord as if it had just been said, and there is no
 * un-sending it.
 */
import { open, stat } from "node:fs/promises";

import { parseLine, type BridgeEvent } from "@tapestopnight/core/bridge";

export interface TailerOptions {
  readonly path: string;
  /** Called for every line that is about a player. Failures are the caller's to log. */
  readonly onEvent: (event: BridgeEvent) => Promise<void>;
  readonly onError: (message: string) => void;
}

export class LogTailer {
  #offset = 0;
  #inode: number | null = null;
  /** A read can stop mid-line; the tail of the buffer waits for the rest. */
  #partial = "";

  constructor(private readonly opts: TailerOptions) {}

  /**
   * Catch up to the end of the file.
   *
   * Never throws: the log is missing for a while during a container restart,
   * and a bridge that dies because the Game Server is restarting is a bridge
   * that is down exactly when people are waiting for it to come back.
   */
  async tick(): Promise<void> {
    let info;
    try {
      info = await stat(this.opts.path);
    } catch {
      // Missing log — the Game Server is between restarts. Forget where we
      // were, so the replacement file is read from its start rather than from
      // a byte offset that means nothing in it.
      this.#offset = 0;
      this.#inode = null;
      this.#partial = "";
      return;
    }

    const rotated = this.#inode !== null && info.ino !== this.#inode;
    const truncated = info.size < this.#offset;
    if (rotated || truncated) {
      this.#offset = 0;
      this.#partial = "";
    }

    if (this.#inode === null) {
      // First sight of this file. If it is the one we were already reading
      // (a normal start after a crash) we still skip to the end, because we
      // cannot know which of its lines were already delivered.
      this.#offset = info.size;
      this.#inode = info.ino;
      return;
    }
    this.#inode = info.ino;

    if (info.size === this.#offset) return;

    const length = info.size - this.#offset;
    const handle = await open(this.opts.path, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.#offset);
      this.#offset += bytesRead;
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }

    const lines = (this.#partial + text).split("\n");
    // The last element is whatever came after the final newline — either an
    // empty string, or the first half of a line still being written.
    this.#partial = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseLine(line.replace(/\r$/, ""));
      if (!event) continue;
      try {
        await this.opts.onEvent(event);
      } catch (err) {
        // One bad event must not stop the rest of the batch, and must not
        // rewind the offset — a line that fails twice would fail forever.
        this.opts.onError(err instanceof Error ? err.message : String(err));
      }
    }
  }
}
