"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { ChatLine } from "@/app/api/chat/route";
import { sendChat } from "@/lib/chat-actions";

/**
 * The in-game chat, on the website.
 *
 * Polls /api/chat every three seconds, in the same shape as LiveStatus: no
 * websocket, no server-sent events, no second process holding a connection per
 * viewer. Chat reads as live at three seconds, and a poll of a Postgres table
 * costs the Game Server nothing at all — unlike the status strip, this path
 * never touches it even indirectly.
 *
 * `?after=<id>` means a browser left open for an hour re-fetches only what was
 * said since its last tick, not the whole window sixty times an hour.
 */
export function ChatPanel({ initial, canPost }: { initial: ChatLine[]; canPost: boolean }) {
  const [lines, setLines] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const feed = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  /*
    The newest id lives in a ref, not in the effect's dependencies.

    Depending on `lines` would tear down and rebuild the interval on every
    arriving message, so the three seconds would restart from each one — a busy
    channel would poll less often than an idle one, which is exactly backwards.
  */
  const newest = useRef(initial.at(-1)?.id ?? 0);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/chat?after=${newest.current}`, { cache: "no-store" });
        if (!res.ok) return;
        const { lines: fresh } = (await res.json()) as { lines: ChatLine[] };
        if (cancelled || fresh.length === 0) return;
        newest.current = fresh[fresh.length - 1]?.id ?? newest.current;
        // Trimmed from the front: a page left open overnight would otherwise
        // grow a DOM node per message said since.
        setLines((prev) => [...prev, ...fresh].slice(-200));
      } catch {
        // Keep showing what we have. A failed poll is evidence about this
        // browser's network, not about the server.
      }
    };

    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  /*
    Follow the conversation, unless the reader has scrolled up.

    Yanking someone back to the bottom while they are reading something further
    up is the single most irritating thing a chat box can do, so the scroll
    position is checked before it is changed.
  */
  useEffect(() => {
    const el = feed.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function onScroll() {
    const el = feed.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await sendChat(text);
      setError(result.ok ? null : result.message);
      if (result.ok) setDraft("");
    });
  }

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem" }}>
      <div
        ref={feed}
        onScroll={onScroll}
        style={{
          height: "min(60vh, 30rem)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
          fontSize: "0.95rem",
          lineHeight: 1.5,
        }}
      >
        {lines.length === 0 ? (
          <p className="faint" style={{ margin: "auto" }}>
            ยังไม่มีใครพูดอะไร
          </p>
        ) : (
          lines.map((line) => <Line key={line.id} line={line} />)
        )}
      </div>

      {canPost ? (
        <form onSubmit={submit} style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={240}
            placeholder="พิมพ์ข้อความ…"
            aria-label="ข้อความ"
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" disabled={pending || !draft.trim()}>
            {pending ? "กำลังส่ง…" : "ส่ง"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="status" style={{ margin: 0, fontSize: "0.88rem", color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Where a line came from, stated rather than implied by colour alone. */
const ORIGIN: Record<ChatLine["source"], { label: string; color: string }> = {
  game: { label: "ในเกม", color: "var(--ok)" },
  web: { label: "เว็บ", color: "var(--accent)" },
  discord: { label: "ดิสคอร์ด", color: "var(--accent-hot)" },
};

function Line({ line }: { line: ChatLine }) {
  const origin = ORIGIN[line.source];
  return (
    <p style={{ margin: 0 }}>
      <span className="faint mono" style={{ fontSize: "0.78rem" }}>
        {new Date(line.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}{" "}
      </span>
      <span className="faint" style={{ fontSize: "0.78rem", color: origin.color }}>
        [{origin.label}]{" "}
      </span>
      <strong>{line.author}</strong>
      <span className="faint">: </span>
      {line.body}
    </p>
  );
}
