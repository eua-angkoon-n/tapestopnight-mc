import { auth, signIn, signOut } from "@/auth";

/**
 * Site header — requirements 2.1 and 2.2.
 *
 * The config link is shown only to admins, but that is tidiness, not security:
 * /config answers a real 403 server-side whether or not the link is rendered
 * (ADR-0004). Hiding a control is never what stops someone using it.
 */
export async function SiteHeader() {
  const session = await auth();
  const configured = Boolean(process.env.AUTH_DISCORD_ID);

  return (
    <header
      style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      <div
        className="wrap"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          padding: "0.7rem 1.25rem",
        }}
      >
        <a
          href="/"
          className="display"
          style={{ color: "var(--text)", textDecoration: "none", fontWeight: 600 }}
        >
          tapestopnight
        </a>

        <nav style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.92rem" }}>
          {session?.isAdmin ? (
            <a href="/config" className="btn" style={{ padding: "0.45rem 0.85rem" }}>
              ตั้งค่าเซิร์ฟเวอร์
            </a>
          ) : null}

          {session ? (
            <>
              <span className="muted">
                {session.user?.name ?? "ล็อกอินแล้ว"}
                {/*
                  Three states, not two. Saying "not an admin" when Discord
                  simply could not be reached sends someone to re-check a role
                  that was never the problem — which is exactly what happened
                  once already.
                */}
                {session.adminCheckFailed ? (
                  <span style={{ color: "var(--tier-guarded)" }}>
                    {" "}
                    · ตรวจสิทธิ์กับ Discord ไม่สำเร็จ
                  </span>
                ) : !session.isAdmin ? (
                  <span className="faint"> · ไม่ใช่แอดมิน</span>
                ) : null}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button type="submit" className="btn" style={{ padding: "0.45rem 0.85rem" }}>
                  ออกจากระบบ
                </button>
              </form>
            </>
          ) : configured ? (
            <form
              action={async () => {
                "use server";
                await signIn("discord", { redirectTo: "/config" });
              }}
            >
              <button type="submit" className="btn" style={{ padding: "0.45rem 0.85rem" }}>
                เข้าสู่ระบบด้วย Discord
              </button>
            </form>
          ) : (
            // Say why rather than showing a button that cannot work. The public
            // pages are fully usable without logging in, so this is a note, not
            // an error state.
            <span className="faint" title="ตั้งค่า DISCORD_CLIENT_ID ในเครื่องก่อน">
              ยังไม่ได้เปิดระบบล็อกอิน
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
