import { desc } from "drizzle-orm";

import { chatMessage, createDb } from "@tapestopnight/core/db";

import type { ChatLine } from "@/app/api/chat/route";
import { auth, signIn } from "@/auth";
import { ChatPanel } from "@/components/ChatPanel";
import { LinkButton } from "@/components/LinkButton";
import { viewerLinkedName } from "@/lib/chat-actions";

/** Always fresh: a chat page served from a build would open on old messages. */
export const dynamic = "force-dynamic";

/**
 * The Chat Bridge, from the website's side.
 *
 * Three states, and they are about capability rather than identity:
 *
 *   not signed in     → read the conversation
 *   signed in         → read it, and a way to prove which player you are
 *   signed in, linked → read it and speak, under your Minecraft name
 *
 * Reading is open on purpose. Nothing on this page is private — it is a public
 * server's public chat — and a wall in front of it would only stop people
 * deciding whether the server is worth joining.
 *
 * The composer is hidden when it cannot be used, but that is tidiness, not
 * security: `sendChat` re-checks the session and the link server-side on every
 * call, the same division `requireAdmin` draws for /config.
 */
export default async function ChatPage() {
  const session = await auth();
  const configured = Boolean(process.env.AUTH_DISCORD_ID);
  const mcName = await viewerLinkedName();

  const { db, sql } = createDb();
  let initial: ChatLine[] = [];
  try {
    const rows = await db
      .select({
        id: chatMessage.id,
        source: chatMessage.source,
        author: chatMessage.authorName,
        body: chatMessage.body,
        at: chatMessage.createdAt,
      })
      .from(chatMessage)
      .orderBy(desc(chatMessage.id))
      .limit(50);
    initial = rows.reverse().map((r) => ({ ...r, at: r.at.toISOString() }));
  } finally {
    await sql.end();
  }

  return (
    <main className="wrap" style={{ padding: "6rem 1.25rem 4rem", maxWidth: "52rem" }}>
      <h1 className="display" style={{ margin: "0 0 0.4rem" }}>
        แชทในเกม
      </h1>
      <p className="muted" style={{ margin: "0 0 1.5rem", maxWidth: "40rem" }}>
        ข้อความในห้องนี้เชื่อมกับแชทในเซิร์ฟเวอร์โดยตรง —
        พิมพ์ที่นี่แล้วคนที่อยู่ในเกมเห็นทันที และที่พูดกันในเกมก็ขึ้นที่นี่
      </p>

      <ChatPanel initial={initial} canPost={Boolean(mcName)} />

      <div style={{ marginTop: "1rem" }}>
        {!session ? (
          configured ? (
            <form
              action={async () => {
                "use server";
                await signIn("discord", { redirectTo: "/chat" });
              }}
            >
              <button type="submit" className="btn">
                ล็อกอิน Discord เพื่อร่วมคุย
              </button>
            </form>
          ) : (
            <p className="faint" style={{ margin: 0 }}>
              ยังไม่ได้ตั้งค่าล็อกอิน Discord บนเซิร์ฟเวอร์นี้ — อ่านได้อย่างเดียว
            </p>
          )
        ) : mcName ? (
          <p className="faint" style={{ margin: 0 }}>
            กำลังพูดในชื่อ <strong className="mono">{mcName}</strong>
          </p>
        ) : (
          <div className="panel" style={{ padding: "1rem" }}>
            <p style={{ margin: "0 0 0.5rem" }}>
              ต้องผูกบัญชี Discord กับผู้เล่นในเกมก่อนถึงจะพิมพ์ได้
            </p>
            {/*
              Why a button and not something automatic: the link is written the
              moment it succeeds, and a page render is not where a write
              belongs. It also makes the fallback legible — the code appears in
              the same place the attempt was made, instead of somewhere else.
            */}
            <p className="faint" style={{ margin: "0 0 0.8rem", fontSize: "0.88rem" }}>
              ระบบจะลองจับคู่จากไอพีที่คุณใช้เข้าเกมให้ก่อน ถ้าจับคู่ไม่ได้
              (เช่น เข้าเว็บผ่านมือถือ หรือมีผู้เล่นหลายคนใช้เน็ตเดียวกัน)
              จะได้โค้ดไปพิมพ์ในเกมแทน
            </p>
            <LinkButton />
          </div>
        )}
      </div>
    </main>
  );
}
