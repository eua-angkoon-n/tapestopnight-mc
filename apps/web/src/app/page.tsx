import { CopyAddress } from "@/components/CopyAddress";
import { LiveStatus } from "@/components/LiveStatus";
import { isStale, loadPublicData, thaiAgo } from "@/lib/data";

/** Always rendered fresh: the status strip must not be served from a build. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { status, info } = await loadPublicData();

  const address = info?.serverAddress ?? "tapestopnight.com";
  const version = info
    ? `Minecraft ${info.minecraftVersion} · Forge ${info.forgeVersion}`
    : "Minecraft 1.12.2 · Forge";

  return (
    <main>
      {/*
        Hero layout, chosen over an art-first marketing hero and over a pure
        status dashboard. Art-first pushes the address below the fold, which
        punishes returning players on every single visit. A pure dashboard
        leaves the page looking broken whenever the server is down. This is a
        strict superset of a plain utility page, so real Dregora artwork can
        replace the texture later without restructuring anything.
      */}
      <section className="hero">
        <div className="wrap" style={{ position: "relative", zIndex: 1, padding: "3.5rem 1.25rem 3rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.35rem", maxWidth: "44rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              {/*
                Rendered from the admin's original upload, not the 64x64
                derivative — that one exists for Minecraft's server list and
                would be a blurry mess at this size. Shown only when an icon
                exists: an empty frame is worse than no frame, the same rule
                the offline state follows.

                Plain <img>, not next/image: the optimizer would pull in sharp,
                which is the dependency the whole icon pipeline avoids.
              */}
              {info?.iconSha ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/icon?h=${info.iconSha.slice(0, 12)}`}
                  alt=""
                  width={72}
                  height={72}
                  style={{
                    display: "block",
                    width: 72,
                    height: 72,
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    objectFit: "cover",
                  }}
                />
              ) : null}
              <h1 className="display" style={{ margin: 0 }}>
                {info?.modpackName ?? "RLCraft Dregora"}
              </h1>
              <LiveStatus
                initial={{
                  online: status.online,
                  playersOnline: status.playersOnline,
                  playersMax: status.playersMax,
                  sample: [...status.sample],
                  lastSeenAgo: thaiAgo(status.lastSeenOnline),
                  stale: isStale(status.probedAt),
                }}
              />
            </div>

            {/* The address is the single most requested thing on any Minecraft
                server site, so it is the largest element on the screen and it
                stays live even when the server is down. */}
            <CopyAddress address={address} />

            <p className="muted" style={{ margin: 0, fontSize: "0.95rem" }}>
              {version}
              {info?.modpackVersion ? ` · ${info.modpackVersion}` : ""}
            </p>

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {info?.downloadUrl ? (
                <a className="btn btn-primary" href={info.downloadUrl}>
                  ดาวน์โหลด Modpack
                </a>
              ) : (
                // Honest placeholder. A dead button that looks alive is worse
                // than one that says it is not ready.
                <span className="btn" aria-disabled="true" style={{ opacity: 0.55, cursor: "default" }}>
                  ลิงก์ดาวน์โหลดยังไม่ได้ตั้ง
                </span>
              )}
              <a className="btn" href="#how-to-join">
                วิธีเข้าเล่น
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ padding: "2.5rem 1.25rem" }} id="how-to-join">
        <h2>วิธีเข้าเล่น</h2>
        <ol className="muted" style={{ paddingLeft: "1.25rem", maxWidth: "44rem" }}>
          <li>
            ลง modpack <strong>{info?.modpackName ?? "RLCraft Dregora"}</strong>
            {info?.modpackVersion ? <> เวอร์ชัน {info.modpackVersion}</> : null} ให้ตรงกับเซิร์ฟเวอร์
            {" "}— เวอร์ชันไม่ตรงกันคือสาเหตุที่พบบ่อยที่สุดของการเข้าไม่ได้
          </li>
          <li>เปิดเกมด้วย {version}</li>
          <li>
            Multiplayer → Add Server → ใส่ <code className="mono">{address}</code>{" "}
            <span className="faint">(ไม่ต้องใส่พอร์ต)</span>
          </li>
        </ol>
      </section>
    </main>
  );
}
