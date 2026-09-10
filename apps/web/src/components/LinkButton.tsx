"use client";

import { useState, useTransition } from "react";

import { linkAccount } from "@/lib/chat-actions";

/**
 * "Work out which player I am."
 *
 * The failure message is the feature, not an error: when the address cannot
 * decide, `linkAccount` returns the `!link` code to type in game, and that
 * message is the whole fallback path. So it is rendered as instructions in a
 * readable panel rather than as red text a reader skims past.
 * → ADR-0016
 */
export function LinkButton() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", alignItems: "flex-start" }}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await linkAccount()))}
      >
        {pending ? "กำลังตรวจ…" : "ผูกบัญชี"}
      </button>

      {result ? (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: "0.9rem",
            lineHeight: 1.6,
            color: result.ok ? "var(--ok)" : "var(--text)",
          }}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
