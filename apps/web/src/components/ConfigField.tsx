"use client";

import { useState, useTransition } from "react";

import { setConfigValue } from "@/lib/config-actions";

/**
 * One config key, rendered according to its Edit Tier — ADR-0003 / ADR-0007.
 *
 * The three tiers are DIFFERENT CONTROLS, not the same control in three
 * colours. Colour is reinforcement only: ember, amber and red sit in one hue
 * zone, and roughly 8% of men with red-green colour vision deficiency cannot
 * separate them. A signal that stops someone destroying the world must not
 * depend on hue.
 */
export interface FieldProps {
  readonly configKey: string;
  readonly value: string;
  readonly tier: "FREE" | "GUARDED" | "LOCKED";
  readonly reason: string | null;
  /** GUARDED fields require typing this exactly before saving. */
  readonly confirmPhrase: string;
}

export function ConfigField(props: FieldProps) {
  if (props.tier === "LOCKED") return <LockedField {...props} />;
  return <EditableField {...props} />;
}

/**
 * LOCKED.
 *
 * There is deliberately NO input element here. Not a disabled one — none. The
 * value is static text, so it cannot be focused, tabbed to, or submitted even
 * through a bug in the form. ADR-0003 keeps locked keys VISIBLE rather than
 * hidden, because an admin who can read why `level-name` is locked will not go
 * looking for the file over SSH — which is the failure ADR-0002 forbids.
 */
function LockedField({ configKey, value, reason }: FieldProps) {
  return (
    <div style={row}>
      <div style={labelCol}>
        <code className="mono" style={{ fontSize: "0.9rem" }}>
          {configKey}
        </code>
        <span
          style={{
            ...badge,
            color: "var(--tier-locked)",
            borderColor: "var(--tier-locked)",
          }}
        >
          <span aria-hidden>🔒</span> LOCKED
        </span>
      </div>
      <div>
        <div
          className="mono"
          style={{
            padding: "0.55rem 0.7rem",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--muted)",
            background: "transparent",
            fontSize: "0.92rem",
          }}
        >
          {value || <span className="faint">(ว่าง)</span>}
        </div>
        {reason ? (
          <p className="faint" style={{ margin: "0.4rem 0 0", fontSize: "0.86rem" }}>
            {reason}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EditableField({ configKey, value, tier, reason, confirmPhrase }: FieldProps) {
  const [draft, setDraft] = useState(value);
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = draft !== value;
  const guarded = tier === "GUARDED";
  const confirmed = !guarded || confirm === confirmPhrase;
  const canSave = dirty && confirmed && !pending;

  function save() {
    startTransition(async () => {
      const r = await setConfigValue(configKey, draft);
      setResult(r.message);
      if (r.ok) setConfirm("");
    });
  }

  return (
    <div style={row}>
      <div style={labelCol}>
        <code className="mono" style={{ fontSize: "0.9rem" }}>
          {configKey}
        </code>
        <span
          style={{
            ...badge,
            color: guarded ? "var(--tier-guarded)" : "var(--muted)",
            borderColor: guarded ? "var(--tier-guarded)" : "var(--border)",
          }}
        >
          {guarded ? <><span aria-hidden>⚠</span> GUARDED</> : "FREE"}
        </span>
      </div>

      <div>
        {/* The thick left border is the GUARDED tier's structural marker: it is
            a different shape, visible without relying on the hue. */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
          {guarded ? (
            <span aria-hidden style={{ width: 4, background: "var(--tier-guarded)", borderRadius: 2 }} />
          ) : null}
          <input
            className="mono"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={reason ? `${configKey}-reason` : undefined}
            style={{
              flex: 1,
              padding: "0.55rem 0.7rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border-strong)",
              background: "var(--bg)",
              color: "var(--text)",
              font: "inherit",
              fontSize: "0.92rem",
            }}
          />
        </div>

        {reason ? (
          <p id={`${configKey}-reason`} className="faint" style={{ margin: "0.4rem 0 0", fontSize: "0.86rem" }}>
            {reason}
          </p>
        ) : null}

        {dirty && guarded ? (
          <div style={{ marginTop: "0.6rem" }}>
            <label style={{ display: "block", fontSize: "0.86rem", marginBottom: "0.3rem" }}>
              พิมพ์ <code className="mono">{confirmPhrase}</code> เพื่อยืนยันการแก้ค่านี้
            </label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={confirmPhrase}
              style={{
                padding: "0.45rem 0.6rem",
                borderRadius: "var(--radius)",
                border: `1px solid ${confirmed ? "var(--ok)" : "var(--tier-guarded)"}`,
                background: "var(--bg)",
                color: "var(--text)",
                font: "inherit",
                fontSize: "0.9rem",
              }}
            />
          </div>
        ) : null}

        {dirty ? (
          <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button type="button" className="btn" onClick={save} disabled={!canSave}
              style={!canSave ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
              {pending ? "กำลังบันทึก…" : "บันทึก"}
            </button>
            <button type="button" className="btn" onClick={() => { setDraft(value); setConfirm(""); setResult(null); }}>
              ยกเลิก
            </button>
          </div>
        ) : null}

        {result ? (
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.88rem" }} role="status">
            {result}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(11rem, 16rem) 1fr",
  gap: "1rem",
  padding: "0.9rem 0",
  borderBottom: "1px solid var(--border)",
  alignItems: "start",
};

const labelCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  alignItems: "flex-start",
};

const badge: React.CSSProperties = {
  fontSize: "0.72rem",
  letterSpacing: "0.04em",
  padding: "0.1rem 0.4rem",
  border: "1px solid",
  borderRadius: 999,
  whiteSpace: "nowrap",
};
