/**
 * Rendered with an HTTP 403 by forbidden() — ADR-0004.
 *
 * A real 403, not a 404 and not a redirect to a login page. The distinction
 * matters for the plan's verification: "hidden from the nav" is not a refusal,
 * and this page exists so the refusal is something you can observe with curl.
 */
export default function Forbidden() {
  return (
    <main className="wrap" style={{ padding: "5rem 1.25rem", maxWidth: "34rem" }}>
      <h1 style={{ fontSize: "1.5rem" }}>ไม่มีสิทธิ์เข้าหน้านี้</h1>
      <p className="muted">
        หน้าตั้งค่าเปิดให้เฉพาะผู้ที่มี role แอดมินใน Discord ของเซิร์ฟเวอร์เท่านั้น
      </p>
      <p className="faint" style={{ fontSize: "0.9rem" }}>
        ถ้าคิดว่าควรเข้าได้ ให้แอดมินตรวจว่า role ถูกกำหนดให้บัญชี Discord ของคุณแล้ว
        การให้สิทธิ์ทำที่เดียวคือการเพิ่ม role นั้น
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <a className="btn" href="/">กลับหน้าแรก</a>
      </p>
    </main>
  );
}
