import { say, type RconOptions } from "./rcon.ts";

/**
 * Warn the people who are actually in the game before kicking them.
 *
 * A restart drops every connected player. A disconnect mid-build loses
 * whatever was in hand and drops anyone in a cave or the Nether back at their
 * last save, and nothing else in this system talks to them — a Discord message
 * reaches whoever is reading Discord, which is not the same set of people.
 *
 * Lives in core because both surfaces restart the Game Server and both should
 * announce it the same way (ADR-0006).
 */

export interface CountdownOptions {
  readonly rcon: RconOptions;
  /** Total lead time. 30 s is enough to get somewhere safe, short enough to respect. */
  readonly totalSeconds?: number;
  /** Short reason shown to players, e.g. "ปรับตั้งค่าเซิร์ฟเวอร์". */
  readonly reason?: string;
  /** Called at each mark, so a caller can mirror the countdown elsewhere. */
  readonly onMark?: (secondsLeft: number) => void;
}

export interface CountdownResult {
  /** True only if every announcement was delivered. */
  readonly announced: boolean;
  /** How many marks failed to send. */
  readonly failedMarks: number;
  /** The first failure, for the log. */
  readonly error: string | null;
}

/**
 * Which marks to announce at.
 *
 * Front-loaded then tightening: the first tells you to stop what you are
 * doing, the last few are the ones you act on. Announcing every second would
 * be noise that players learn to filter out.
 */
const MARKS = [30, 15, 10, 5, 4, 3, 2, 1];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Count down in-game, then return. The caller performs the restart.
 *
 * **The clock is honoured even when announcing fails.** Each `say` is caught
 * individually rather than aborting the loop, because the alternative is
 * worse than a missing message: an RCON error at the 15 s mark would return
 * early and the restart would land fifteen seconds before the time players
 * were given. A countdown that lies about when it ends is more dangerous than
 * no countdown, since players act on it.
 *
 * Never throws. A broken RCON connection means the announcement failed, not
 * that the operator may not restart their own server.
 */
export async function announceRestart(opts: CountdownOptions): Promise<CountdownResult> {
  const total = opts.totalSeconds ?? 30;
  const reason = opts.reason ? ` (${opts.reason})` : "";
  const marks = MARKS.filter((m) => m <= total);

  let failedMarks = 0;
  let firstError: string | null = null;

  // A fresh connection per mark. Holding one open across the whole countdown
  // invites an idle timeout partway through, which is the failure this is
  // built to tolerate rather than to risk.
  const announce = async (message: string) => {
    try {
      await say(opts.rcon, message);
    } catch (err) {
      failedMarks++;
      firstError ??= err instanceof Error ? err.message : String(err);
    }
  };

  let remaining = total;
  for (const mark of marks) {
    const wait = remaining - mark;
    if (wait > 0) await sleep(wait * 1000);
    remaining = mark;
    opts.onMark?.(mark);
    await announce(
      `[เซิร์ฟเวอร์] รีสตาร์ทในอีก ${mark} วินาที${reason} — หาที่ปลอดภัยแล้วออกจากเกม`,
    );
  }

  // Whatever is left after the final mark, so the total lead time is real.
  if (remaining > 0) await sleep(remaining * 1000);
  await announce("[เซิร์ฟเวอร์] กำลังรีสตาร์ท เดี๋ยวกลับมา");

  return { announced: failedMarks === 0, failedMarks, error: firstError };
}
