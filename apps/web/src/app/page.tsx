import { CopyAddress } from "@/components/CopyAddress";
import { LiveStatus } from "@/components/LiveStatus";
import { isStale, loadPublicData, thaiAgo } from "@/lib/data";

/** Always rendered fresh: the status strip must not be served from a build. */
export const dynamic = "force-dynamic";

/**
 * The public landing page — requirement 2.3.
 *
 * Three scrolled sections, following the Velorah template's structure with
 * this project's own tokens (ADR-0007 unchanged): a full-height hero over
 * background video, the wiki embedded in a rounded frame, and an about card
 * grid.
 *
 * Entirely server-rendered. The only client code on this page is the two
 * islands that already existed — the polled status pill and the copy button —
 * so a landing page with video and an embed costs the same JS as before
 * (ADR-0006).
 */

const GITHUB_URL = "https://github.com/eua-angkoon-n";

/*
  Written down rather than fetched.

  A GitHub API call on every render would buy nothing here — this profile has
  no bio and two public repositories — while adding latency to the page and an
  unauthenticated rate limit that fails in a way visitors would see.
*/
const AUTHOR = {
  name: "tape_stop_night",
  location: "Thailand",
} as const;

export default async function HomePage() {
  const { status, info } = await loadPublicData();

  const address = info?.serverAddress ?? "tapestopnight.com";
  const version = info
    ? `Minecraft ${info.minecraftVersion} · Forge ${info.forgeVersion}`
    : "Minecraft 1.12.2 · Forge";

  return (
    <main>
      {/* ── 1. Hero ─────────────────────────────────────────────── */}
      <section id="home" className="section-tall">
        {/* Behind the video: the still that reduced-motion users get instead
            of a loop, and what everyone sees while the video is arriving. */}
        <div className="media-poster" aria-hidden="true" />
        {/*
          muted + playsInline are not optional: iOS refuses to autoplay
          without both, and would show a stalled first frame with a play
          button over it instead of a background.

          preload="metadata" keeps the video off the critical path — the
          poster above is what makes that safe.
        */}
        <video
          className="media-bg"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/media/dregora-poster.jpg"
          aria-hidden="true"
          tabIndex={-1}
        >
          <source src="/media/dregora.mp4" type="video/mp4" />
        </video>
        <div className="scrim" />

        <div
          className="wrap section-content"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: "1.5rem",
            padding: "7rem 1.25rem 5rem",
          }}
        >
          {info?.iconSha ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/icon?h=${info.iconSha.slice(0, 12)}`}
              alt=""
              width={84}
              height={84}
              style={{
                width: 84,
                height: 84,
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border-strong)",
                objectFit: "cover",
              }}
            />
          ) : null}

          <h1
            className="display"
            style={{
              margin: 0,
              fontSize: "clamp(2.6rem, 8vw, 5rem)",
              lineHeight: "var(--leading-tight)",
              letterSpacing: "0.02em",
            }}
          >
            tapestopnight
          </h1>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.9rem",
              flexWrap: "wrap",
            }}
          >
            <p style={{ margin: 0, fontSize: "clamp(1.05rem, 2.4vw, 1.4rem)" }}>
              {info?.modpackName ?? "RLCraft Dregora"}
            </p>
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

          {/* Still the largest element on the screen, and still live when the
              server is down — the address is what returning players come for. */}
          <CopyAddress address={address} />

          <p className="muted" style={{ margin: 0, fontSize: "0.95rem" }}>
            {version}
            {info?.modpackVersion ? ` · ${info.modpackVersion}` : ""}
          </p>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
            {info?.downloadUrl ? (
              <a
                className="btn btn-primary"
                href={info.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download
              </a>
            ) : (
              // An honest placeholder. A dead button that looks alive is worse
              // than one that says it is not ready.
              <span className="btn" aria-disabled="true" style={{ opacity: 0.55, cursor: "default" }}>
                ยังไม่ได้ตั้งลิงก์ดาวน์โหลด
              </span>
            )}
            {info?.discordUrl ? (
              <a className="btn" href={info.discordUrl} target="_blank" rel="noopener noreferrer">
                Discord
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── 2. Wiki ─────────────────────────────────────────────── */}
      <section id="wiki" style={{ padding: "3.5rem 0" }}>
        <div className="wrap-wide">
          <header
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
              marginBottom: "1.25rem",
            }}
          >
            <div>
              <h2 className="display" style={{ margin: 0, fontSize: "clamp(1.8rem, 4vw, 2.8rem)" }}>
                Wiki
              </h2>
              <p className="muted" style={{ margin: "0.4rem 0 0", maxWidth: "44rem" }}>
                คู่มือ RLCraft Dregora
              </p>
            </div>
            {/*
              Always visible, never conditional.

              wiki.gg is somebody else's site. The day they add an
              X-Frame-Options header this frame becomes a silent blank box, and
              a cross-origin iframe that has been refused cannot be detected
              from JavaScript. A link that is always there is the only thing
              that keeps this section useful on that day.
            */}
            {info?.wikiUrl ? (
              <a className="btn" href={info.wikiUrl} target="_blank" rel="noopener noreferrer">
                เปิดใน wiki.gg ↗
              </a>
            ) : null}
          </header>

          {info?.wikiUrl ? (
            <div className="frame-panel">
              <iframe
                src={info.wikiUrl}
                title="RLCraft Dregora Wiki"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                /* Nearly the whole viewport. dvh, not vh: on mobile the
                   address bar retracts, and vh would leave the frame taller
                   than the screen with its bottom edge permanently cut off. */
                style={{ height: "88dvh", minHeight: "34rem" }}
              />
            </div>
          ) : (
            <div className="panel" style={{ padding: "2rem" }}>
              <p className="muted" style={{ margin: 0 }}>
                ยังไม่ได้ตั้งลิงก์ wiki
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── 3. About ────────────────────────────────────────────── */}
      <section id="about" style={{ padding: "1rem 0 6rem" }}>
        <div className="wrap">
          <div className="card-grid">
            <div className="card-lg">
              <span className="card-badge" aria-hidden="true">
                ◆
              </span>

              <div>
                <h2
                  className="display"
                  style={{
                    margin: "0 0 1.1rem",
                    fontSize: "clamp(1.8rem, 4vw, 3rem)",
                    lineHeight: "var(--leading-tight)",
                  }}
                >
                  About Me
                </h2>
                <p className="muted" style={{ margin: 0, maxWidth: "32rem" }}>
                  เซิร์ฟเวอร์และหน้าเว็บทั้งหมด รวมถึงบอท Discord สร้างและดูแลโดย{" "}
                  <strong style={{ color: "var(--text)" }}>{AUTHOR.name}</strong>
                </p>
                <p className="faint" style={{ margin: "0.75rem 0 0", fontSize: "0.9rem" }}>
                  {AUTHOR.location}
                </p>
              </div>

              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <a
                  className="btn btn-primary"
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub ↗
                </a>
              </div>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="card-media"
              src="/media/about.webp"
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
