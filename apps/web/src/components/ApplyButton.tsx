"use client";

import { useState, useTransition } from "react";

import { applyConfig } from "@/lib/config-actions";

/**
 * Apply — ADR-0002.
 *
 * The only path by which a config change reaches players, and it restarts the
 * Game Server. Restart-bearing, so it is a separate explicit action rather than
 * something that quietly happens on save, and it asks first.
 */
export function ApplyButton({ pendingCount }: { pendingCount: number }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function go() {
    startTransition(async () => {
      setResult(await applyConfig());
      setConfirming(false);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", alignItems: "flex-end" }}>
      {!confirming ? (
        <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={pending}>
          Apply {pendingCount > 0 ? `(${pendingCount} รอ)` : ""}
        </button>
      ) : (
        <div className="panel" style={{ padding: "0.9rem", maxWidth: "26rem" }}>
          <p style={{ margin: "0 0 0.6rem", fontSize: "0.92rem" }}>
            Apply จะเขียน <code className="mono">server.properties</code> ใหม่ทับของเดิม
            แล้ว <strong>รีสตาร์ทเซิร์ฟเวอร์</strong> — ผู้เล่นที่อยู่ในเกมจะหลุดออก
          </p>
          <p className="faint" style={{ margin: "0 0 0.8rem", fontSize: "0.85rem" }}>
            การเซฟโลก OTG ขนาดใหญ่ใช้เวลาหลายนาที ระบบรออยู่แล้วไม่ตัดกลางทาง
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-primary" onClick={go} disabled={pending}>
              {pending ? "กำลังทำ…" : "ยืนยัน Apply"}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={pending}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
      {result ? (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: "0.9rem",
            color: result.ok ? "var(--ok)" : "var(--danger)",
            maxWidth: "30rem",
            textAlign: "right",
          }}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
