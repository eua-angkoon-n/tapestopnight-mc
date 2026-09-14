"use client";

import { useState } from "react";

/**
 * The single most-used control on the site: copy the address into the clipboard.
 *
 * One of only a few client components on purpose (ADR-0006). The design was
 * chosen so the page is server-rendered and interactivity stays this small.
 */
export function CopyAddress({ address }: { address: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
    } catch {
      // Clipboard access can be refused (insecure context, permissions). Say
      // so rather than showing a success tick that did nothing — the whole
      // point of the button is that the player trusts they now have the address.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <code
        className="display"
        style={{
          fontSize: "clamp(1.35rem, 4.5vw, 2.1rem)",
          fontWeight: 600,
          letterSpacing: "0.01em",
          // `currentColor`, not --text: this sits inside the hero, where the
          // surrounding .on-media has already decided what colour reads against
          // a photograph. --text is the cream theme's near-black and vanishes there.
          color: "currentColor",
          borderBottom: "2px solid var(--accent)",
          paddingBottom: "0.15rem",
        }}
      >
        {address}
      </code>
      <button type="button" className="btn" onClick={copy} aria-live="polite">
        {state === "copied" ? "คัดลอกแล้ว" : state === "failed" ? "คัดลอกไม่ได้" : "คัดลอก"}
      </button>
    </div>
  );
}
