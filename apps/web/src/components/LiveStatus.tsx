"use client";

import { useEffect, useState } from "react";

export interface StatusView {
  online: boolean;
  playersOnline: number | null;
  playersMax: number | null;
  sample: string[];
  lastSeenAgo: string | null;
  stale: boolean;
}

/**
 * Refreshes the status strip every 30 seconds.
 *
 * It polls /api/status, which reads the Status Poller's cache row — it does
 * NOT reach the Game Server. The poller probes every 15 s, so 30 s here means
 * a visitor is never looking at data more than about 45 s old while the Game
 * Server's probe load stays flat no matter how many people are watching.
 */
export function LiveStatus({ initial }: { initial: StatusView }) {
  const [s, setS] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as StatusView;
        if (!cancelled) setS(next);
      } catch {
        // Keep showing the last known values. A failed poll is not evidence
        // about the Game Server — it is evidence about this browser's network.
      }
    };
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <StatusPill status={s} />
      {/* When the server is down the who's-online strip is REMOVED, not
          rendered empty. An empty box reads as a broken page; its absence
          reads as "nobody is on", which is the truth. */}
      {s.online && s.sample.length > 0 ? <OnlineStrip names={s.sample} /> : null}
    </>
  );
}

function StatusPill({ status }: { status: StatusView }) {
  const { online, playersOnline, playersMax, lastSeenAgo, stale } = status;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.55rem",
        padding: "0.35rem 0.8rem",
        borderRadius: 999,
        border: `1px solid ${online ? "var(--ok)" : "var(--border-strong)"}`,
        background: online ? "rgba(78,139,87,0.12)" : "var(--surface)",
        fontSize: "0.92rem",
        lineHeight: 1.3,
      }}
    >
      <span aria-hidden style={{ color: online ? "var(--ok)" : "var(--faint)" }}>
        {online ? "●" : "○"}
      </span>
      {online ? (
        <span>
          ออนไลน์{" "}
          <strong className="mono">
            {playersOnline ?? 0}/{playersMax ?? 0}
          </strong>
        </span>
      ) : (
        <span className="muted">
          ปิดอยู่
          {lastSeenAgo ? <> · ออนไลน์ล่าสุด {lastSeenAgo}</> : null}
        </span>
      )}
      {/* Surfaced rather than hidden: if the poller has frozen, the numbers
          beside this are not current and the visitor deserves to know. */}
      {stale ? <span className="faint">· ข้อมูลอาจไม่อัปเดต</span> : null}
    </div>
  );
}

function OnlineStrip({ names }: { names: string[] }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <span className="muted" style={{ fontSize: "0.92rem" }}>
        ใครออนตอนนี้
      </span>
      {names.map((n) => (
        <span
          key={n}
          className="mono"
          style={{
            fontSize: "0.85rem",
            padding: "0.2rem 0.55rem",
            borderRadius: "var(--radius)",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
          }}
        >
          {n}
        </span>
      ))}
    </div>
  );
}
