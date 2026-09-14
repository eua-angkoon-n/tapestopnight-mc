/**
 * The palette, as the one place that holds it outside CSS.
 *
 * The website's tokens live in `apps/web/src/app/globals.css` and are the
 * source of the design (ADR-0007). Discord cannot read CSS custom properties,
 * so an embed colour has to be an integer — and until this file existed, six
 * of them were written as literals across three bot handlers. The web moved to
 * the cozy palette and the bot kept answering in ember, which is exactly the
 * failure a shared module prevents.
 *
 * Keep these in step with `globals.css` by hand; there are six numbers and a
 * build step that parsed CSS would be more machinery than the problem needs.
 *
 * ── Why these are not always the literal web token ────────────────────────
 *
 * The site renders on cream. An embed renders on whatever theme the reader
 * chose in Discord, which for most people is near-black. Two of the colours
 * therefore take the lighter sibling of the web token: a value tuned to clear
 * 4.5:1 against #faf6ee is doing the wrong job on #313338.
 */

/** Terracotta. The ordinary accent — informational embeds. `--accent`. */
export const ACCENT = 0xc2683c;

/**
 * Slate, matching `--tier-locked`, and deliberately NOT a red.
 *
 * This used to be 0x8a3b32, which put LOCKED in the same hue zone as a
 * failure. ADR-0007 keeps the tiers apart structurally rather than by hue
 * precisely because those reds are hard to separate; a cool grey says
 * "you may not edit this" without also saying "something went wrong".
 */
export const LOCKED = 0x5b6470;

/**
 * Sage, not the web's `--ok` (#43794f).
 *
 * `--ok` is a text colour picked for contrast on cream and goes muddy as a
 * stripe on a dark embed. Sage is `--sage`, the same green one step lighter.
 */
export const OK = 0x6e8b5e;

/** Amber, matching `--tier-guarded`. */
export const WARN = 0xb8801a;

/** The danger red, matching `--danger`. */
export const DOWN = 0xa8412f;
