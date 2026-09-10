import { auth, signIn, signOut } from "@/auth";

/**
 * Site header — requirements 2.1 and 2.2.
 *
 * Three-part bar: name on the left, section links in the middle, the account
 * control on the right. Sticky and translucent so it sits over the hero video
 * rather than cutting a solid band across it.
 *
 * Still a SERVER component. It calls auth() and renders sign-in/sign-out as
 * server actions, so the landing page gains a navigation bar without gaining a
 * client bundle (ADR-0006).
 *
 * The config link is shown only to admins, but that is tidiness, not security:
 * /config answers a real 403 server-side whether or not the link is rendered
 * (ADR-0004). Hiding a control is never what stops someone using it.
 */

/**
 * Absolute, not bare fragments.
 *
 * `#wiki` from /config would look for an element on the config page and do
 * nothing. `/#wiki` navigates home first and then scrolls, so the bar behaves
 * the same on every page.
 */
const SECTIONS = [
  { href: "/#home", label: "หน้าแรก" },
  { href: "/chat", label: "แชท" },
  { href: "/#wiki", label: "Wiki" },
  { href: "/#about", label: "เกี่ยวกับ" },
] as const;

export async function SiteHeader() {
  const session = await auth();
  const configured = Boolean(process.env.AUTH_DISCORD_ID);

  return (
    <header className="site-nav">
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
          style={{
            color: "var(--text)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "1.05rem",
            flex: "none",
          }}
        >
          tapestopnight
        </a>

        {/*
          Wraps instead of scrolling horizontally on narrow screens. A nav that
          scrolls sideways hides its own last item, and "ตั้งค่าเซิร์ฟเวอร์" is
          the longest label here.
        */}
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.4rem",
            flexWrap: "wrap",
            flex: 1,
          }}
        >
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} className="nav-link">
              {s.label}
            </a>
          ))}
          {session?.isAdmin ? (
            <a href="/config" className="nav-link" style={{ color: "var(--accent)" }}>
              ตั้งค่าเซิร์ฟเวอร์
            </a>
          ) : null}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flex: "none" }}>
          {session ? (
            <>
              <span className="muted" style={{ fontSize: "0.88rem" }}>
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
              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: "0.45rem 0.95rem" }}
              >
                เข้าสู่ระบบ
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
        </div>
      </div>
    </header>
  );
}
