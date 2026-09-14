import { auth } from "@/auth";

/**
 * Rendered with an HTTP 403 by forbidden() — ADR-0004.
 *
 * A real 403, not a 404 and not a redirect to a login page. The distinction
 * matters for the plan's verification: "hidden from the nav" is not a refusal,
 * and this page exists so the refusal is something you can observe with curl.
 */
export default async function Forbidden() {
  // A refusal because Discord could not be ASKED is a different problem from a
  // refusal because Discord said no, and it needs different advice: one is
  // "get the role", the other is "sign in again, the role is fine".
  const session = await auth();
  const couldNotCheck = session?.adminCheckFailed ?? false;
  const rateLimited = session?.adminCheckRateLimited ?? false;
  const retryIn = session?.adminCheckRetryInSeconds ?? 0;

  return (
    <main className="wrap" style={{ padding: "5rem 1.25rem", maxWidth: "34rem" }}>
      <h1 style={{ fontSize: "1.5rem" }}>
        {couldNotCheck ? "ตรวจสอบสิทธิ์ไม่สำเร็จ" : "ไม่มีสิทธิ์เข้าหน้านี้"}
      </h1>
      {couldNotCheck ? (
        <>
          <p className="muted">
            ระบบถาม Discord ว่าคุณถือ role อะไรอยู่ไม่สำเร็จ จึงปฏิเสธไว้ก่อนเพื่อความปลอดภัย
            — <strong>ไม่ได้แปลว่า role ของคุณผิด</strong>
          </p>
          {rateLimited ? (
            /*
              Deliberately the opposite advice from the outage case. A rate
              limit is Discord saying "you have asked too often"; signing in
              again forces another immediate ask, which is the one thing that
              cannot help and can extend the limit.
            */
            <p className="faint" style={{ fontSize: "0.9rem" }}>
              Discord จำกัดจำนวนครั้งที่ถามได้ และตอนนี้ถามถี่เกินไป
              {retryIn > 0 ? ` ระบบจะลองใหม่ให้เองในอีกราว ${retryIn} วินาที` : " ระบบจะลองใหม่ให้เองในอีกสักครู่"}
              {" "}— <strong>อย่าเพิ่งออกจากระบบแล้วเข้าใหม่</strong>{" "}
              เพราะการเข้าใหม่จะบังคับให้ถาม Discord ทันที ซึ่งทำให้ถูกจำกัดนานขึ้น
              รอแล้วรีเฟรชหน้านี้พอ
            </p>
          ) : (
            <p className="faint" style={{ fontSize: "0.9rem" }}>
              มักแก้ได้ด้วยการออกจากระบบแล้วเข้าใหม่ เพราะการเข้าใหม่จะขอสิทธิ์อ่าน role
              จาก Discord อีกครั้ง ถ้ายังไม่หาย แปลว่าเป็นฝั่ง Discord เอง
              รายละเอียดจะอยู่ใน log ของเว็บแล้ว
            </p>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            หน้าตั้งค่าเปิดให้เฉพาะผู้ที่มี role แอดมินใน Discord ของเซิร์ฟเวอร์เท่านั้น
          </p>
          <p className="faint" style={{ fontSize: "0.9rem" }}>
            ถ้าคิดว่าควรเข้าได้ ให้แอดมินตรวจว่า role ถูกกำหนดให้บัญชี Discord ของคุณแล้ว
            การให้สิทธิ์ทำที่เดียวคือการเพิ่ม role นั้น
          </p>
        </>
      )}
      <p style={{ marginTop: "1.5rem" }}>
        <a className="btn" href="/">กลับหน้าแรก</a>
      </p>
    </main>
  );
}
