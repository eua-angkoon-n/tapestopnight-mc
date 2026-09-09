import { forbidden } from "next/navigation";
import { desc } from "drizzle-orm";

import { configHistory, configKey, createDb, serverInfo } from "@tapestopnight/core/db";
import { tierFor } from "@tapestopnight/core/config";

import { auth } from "@/auth";
import { ApplyButton } from "@/components/ApplyButton";
import { ConfigField } from "@/components/ConfigField";
import { IconUpload } from "@/components/IconUpload";

export const dynamic = "force-dynamic";

/**
 * The admin config page — requirement 2, ADR-0002 / ADR-0003 / ADR-0004.
 *
 * Gated SERVER-SIDE with a real 403. Not hidden, not redirected: the plan's
 * verification is that a non-admin hitting this URL directly is refused, and
 * "the link isn't in the nav" is not a refusal.
 */
export default async function ConfigPage() {
  const session = await auth();
  if (!session?.isAdmin) forbidden();

  const { db, sql } = createDb();
  try {
    const [rows, history, infoRows] = await Promise.all([
      db.select().from(configKey).orderBy(configKey.key),
      db.select().from(configHistory).orderBy(desc(configHistory.changedAt)).limit(15),
      // Columns named explicitly so the two icon blobs stay in Postgres. This
      // page needs to know an icon EXISTS, not to carry it.
      db
        .select({
          serverAddress: serverInfo.serverAddress,
          iconSha: serverInfo.iconSourceSha256,
          iconUpdatedBy: serverInfo.iconUpdatedBy,
          iconUpdatedAt: serverInfo.iconUpdatedAt,
        })
        .from(serverInfo)
        .limit(1),
    ]);

    const info = infoRows[0];
    const confirmPhrase = info?.serverAddress ?? "tapestopnight.com";
    const currentIcon = info?.iconSha
      ? {
          sha: info.iconSha,
          updatedBy: info.iconUpdatedBy,
          updatedAt: info.iconUpdatedAt
            ? info.iconUpdatedAt.toISOString().slice(0, 16).replace("T", " ")
            : null,
        }
      : null;

    // Grouped by tier, editable first. A wall of 40 keys in alphabetical order
    // buries the three an admin actually came to change.
    const groups = (["FREE", "GUARDED", "LOCKED"] as const).map((tier) => ({
      tier,
      rows: rows.filter((r) => tierFor(r.key).tier === tier),
    }));

    return (
      <main className="wrap" style={{ padding: "2rem 1.25rem 4rem" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1.5rem",
            flexWrap: "wrap",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <h1 style={{ marginBottom: "0.25rem", fontSize: "1.6rem" }}>ตั้งค่าเซิร์ฟเวอร์</h1>
            <p className="muted" style={{ margin: 0, fontSize: "0.92rem" }}>
              ค่าทั้งหมดเก็บใน Postgres และเป็นแหล่งความจริง — ไฟล์{" "}
              <code className="mono">server.properties</code> บนเครื่องเป็นผลลัพธ์ที่ระบบเขียนให้
              แก้ไฟล์นั้นด้วยมือจะหายเมื่อกด Apply ครั้งถัดไป
            </p>
            {session.adminVia === "break-glass" ? (
              <p style={{ margin: "0.6rem 0 0", fontSize: "0.88rem", color: "var(--tier-guarded)" }}>
                ⚠ คุณเข้าถึงสิทธิ์นี้ผ่าน break-glass allowlist ไม่ใช่ role ใน Discord —
                ถ้าไม่ได้ตั้งใจ ให้ตรวจการตั้ง role ใน guild
              </p>
            ) : null}
          </div>
          <ApplyButton pendingCount={0} />
        </header>

        {/*
          Above the key list on purpose. The icon is not a server.properties
          key, so it has nowhere to sit in the tiered groups below, and it is
          the one thing on this page an admin can get wrong in a way that
          produces no error anywhere.
        */}
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.25rem" }}>ไอคอนเซิร์ฟเวอร์</h2>
          <p className="faint" style={{ margin: "0 0 0.5rem", fontSize: "0.86rem", maxWidth: "48rem" }}>
            ไม่ใช่คีย์ใน <code className="mono">server.properties</code> แต่เดินทางไปหาผู้เล่นทาง
            Apply เหมือนกัน เพราะ Minecraft อ่านไฟล์ไอคอนตอนเซิร์ฟเวอร์เริ่มทำงานเท่านั้น
          </p>
          <div className="panel" style={{ padding: "1rem" }}>
            <IconUpload current={currentIcon} />
          </div>
        </section>

        {groups.map(({ tier, rows: groupRows }) =>
          groupRows.length === 0 ? null : (
            <section key={tier} style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.05rem", marginBottom: "0.25rem" }}>
                {tier === "FREE"
                  ? "แก้ได้ตามปกติ"
                  : tier === "GUARDED"
                    ? "แก้ได้ แต่ต้องยืนยัน"
                    : "ล็อกไว้ — แก้ผ่านเว็บไม่ได้"}
                <span className="faint" style={{ fontWeight: 400, fontSize: "0.85rem" }}>
                  {"  "}
                  {groupRows.length} คีย์
                </span>
              </h2>
              {tier === "LOCKED" ? (
                <p className="faint" style={{ margin: "0 0 0.5rem", fontSize: "0.86rem", maxWidth: "48rem" }}>
                  แสดงไว้ให้เห็นโดยตั้งใจ พร้อมเหตุผล เพื่อไม่ให้ต้องไปหาไฟล์แก้เองบนเครื่อง
                  ซึ่งเป็นสิ่งที่ระบบนี้ออกแบบมาเพื่อป้องกัน
                </p>
              ) : null}
              <div className="panel" style={{ padding: "0.25rem 1rem" }}>
                {groupRows.map((r) => {
                  const rule = tierFor(r.key);
                  return (
                    <ConfigField
                      key={r.key}
                      configKey={r.key}
                      value={r.value}
                      tier={rule.tier}
                      reason={rule.reason}
                      confirmPhrase={confirmPhrase}
                    />
                  );
                })}
              </div>
            </section>
          ),
        )}

        <section>
          <h2 style={{ fontSize: "1.05rem" }}>ประวัติการแก้</h2>
          {history.length === 0 ? (
            <p className="faint" style={{ fontSize: "0.9rem" }}>ยังไม่มีการแก้ค่าผ่านเว็บ</p>
          ) : (
            <div className="panel" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr className="muted">
                    <th style={th}>เมื่อ</th>
                    <th style={th}>คีย์</th>
                    <th style={th}>จาก</th>
                    <th style={th}>เป็น</th>
                    <th style={th}>โดย</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td style={td}>{h.changedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                      <td style={td}><code className="mono">{h.key}</code></td>
                      <td style={{ ...td, color: "var(--faint)" }}>{h.oldValue ?? "—"}</td>
                      <td style={td}>{h.newValue}</td>
                      <td style={{ ...td, color: "var(--muted)" }}><code className="mono">{h.changedBy}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    );
  } finally {
    await sql.end();
  }
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.6rem 0.8rem",
  borderBottom: "1px solid var(--border)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "0.55rem 0.8rem",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};
