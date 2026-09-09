"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Imported from the subpath, not the barrel: the barrel re-exports the
// renderer and Apply, which reach for node:fs and would not survive being
// pulled into a browser bundle. Sharing the constant is the point — a limit
// the client enforces and the server enforces separately is a limit that will
// eventually disagree with itself.
import { MAX_SOURCE_BYTES } from "@tapestopnight/core/config/icon";

import { uploadServerIcon } from "@/lib/config-actions";

/**
 * Server Icon upload - one file in, two artifacts out.
 *
 * Minecraft requires server-icon.png to be EXACTLY 64x64 and silently ignores
 * any other size, so asking an admin to supply a 64px file is a trap: they
 * would get no error and no icon. Instead they upload one high-resolution
 * square image, this resizes it, and the page keeps the original for the hero
 * so a 64px image is never upscaled into a blurry banner.
 *
 * The resize runs here, in the browser, rather than server-side. A native
 * image library would add ~30 MB of resident memory to a web container capped
 * at 384 MB beside a 7 GB JVM (ADR-0012). The server does NOT trust the result:
 * it reads the PNG header itself and refuses anything that is not 64x64, so
 * this component is a convenience and never the check.
 *
 * A client island, per ADR-0006 - which names an image upload as one of the
 * four places interactivity is expected. No SPA, no state library.
 */

export interface CurrentIcon {
  readonly sha: string;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

const ACCEPT = "image/png,image/jpeg,image/webp";

interface Picked {
  readonly file: File;
  readonly width: number;
  readonly height: number;
  readonly previewUrl: string;
  readonly icon64: Blob;
  readonly icon64Url: string;
}

export function IconUpload({ current }: { current: CurrentIcon | null }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function reset() {
    if (picked) {
      URL.revokeObjectURL(picked.previewUrl);
      URL.revokeObjectURL(picked.icon64Url);
    }
    setPicked(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onPick(file: File | undefined) {
    setError(null);
    setResult(null);
    reset();
    if (!file) return;

    if (file.size > MAX_SOURCE_BYTES) {
      setError(
        `ไฟล์ใหญ่เกินไป ${(file.size / 1024 / 1024).toFixed(1)} MB — จำกัดไว้ที่ 2 MB`,
      );
      return;
    }

    let bitmap: ImageBitmap;
    try {
      // from-image so a phone photo's EXIF rotation is honoured rather than
      // baked in sideways.
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      setError("เปิดไฟล์รูปไม่ได้ — รับเฉพาะ PNG, JPEG หรือ WebP");
      return;
    }

    try {
      if (Math.abs(bitmap.width - bitmap.height) > 1) {
        setError(
          `รูปต้องเป็นสี่เหลี่ยมจัตุรัส แต่ไฟล์นี้ ${bitmap.width}×${bitmap.height} — ` +
            `ครอบตัดให้เป็นจัตุรัสก่อนแล้วค่อยอัปโหลด`,
        );
        return;
      }
      if (bitmap.width < 64) {
        setError(`รูปเล็กกว่า 64×64 (${bitmap.width}×${bitmap.height}) — ใช้รูปที่ละเอียดกว่านี้`);
        return;
      }

      const icon64 = await toIcon64(bitmap);
      if (!icon64) {
        setError("ย่อรูปไม่สำเร็จในเบราว์เซอร์นี้");
        return;
      }

      setPicked({
        file,
        width: bitmap.width,
        height: bitmap.height,
        previewUrl: URL.createObjectURL(file),
        icon64,
        icon64Url: URL.createObjectURL(icon64),
      });
    } finally {
      bitmap.close();
    }
  }

  function submit() {
    if (!picked) return;
    const form = new FormData();
    form.set("source", picked.file, picked.file.name);
    form.set("icon64", picked.icon64, "server-icon.png");

    startTransition(async () => {
      try {
        const r = await uploadServerIcon(form);
        setResult(r);
        if (r.ok) {
          reset();
          // The page reads the icon back through /api/icon, keyed by digest, so
          // the fresh render is what shows the new image.
          router.refresh();
        }
      } catch (err) {
        /*
          Not decoration. Some failures never reach the action at all — the
          framework rejects an oversized Server Action body with a 413 before
          our code runs — and without this the promise simply rejected, the
          button stayed on "กำลังอัปโหลด…", and the admin saw an upload that
          did nothing and said nothing. An error with no message is
          indistinguishable from being ignored.
        */
        setResult({
          ok: false,
          message:
            "อัปโหลดไม่สำเร็จ — เซิร์ฟเวอร์ปฏิเสธคำขอ " +
            "ถ้าไฟล์ใหญ่ใกล้ 2 MB ให้ลองย่อรูปลงก่อน " +
            `(${err instanceof Error ? err.message : String(err)})`,
        });
      }
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(11rem, 16rem) 1fr", gap: "1rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-start" }}>
        <code className="mono" style={{ fontSize: "0.9rem" }}>
          server-icon
        </code>
        <span
          style={{
            fontSize: "0.72rem",
            letterSpacing: "0.04em",
            padding: "0.1rem 0.4rem",
            border: "1px solid var(--border)",
            borderRadius: 999,
            color: "var(--muted)",
            whiteSpace: "nowrap",
          }}
        >
          FREE
        </span>
      </div>

      <div>
        <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          <Preview
            label="ที่ผู้เล่นเห็นตอนนี้"
            src={current ? `/api/icon?v=64&h=${current.sha.slice(0, 12)}` : null}
            emptyText="ยังไม่มีไอคอน"
          />
          {picked ? (
            <>
              <span aria-hidden className="faint" style={{ alignSelf: "center", fontSize: "1.4rem" }}>
                →
              </span>
              <Preview label="หลังกด Apply" src={picked.icon64Url} emptyText="" highlight />
            </>
          ) : null}
        </div>

        <p className="faint" style={{ margin: "0.75rem 0 0.5rem", fontSize: "0.86rem", maxWidth: "44rem" }}>
          อัปโหลดรูป <strong>สี่เหลี่ยมจัตุรัส</strong> ความละเอียดสูงรูปเดียว ระบบจะย่อเป็น{" "}
          <code className="mono">64×64</code> ให้เอง — Minecraft รับเฉพาะขนาดนี้เป๊ะ ๆ
          และจะ<strong>เมินไฟล์ขนาดอื่นแบบเงียบ ๆ</strong> ต้นฉบับถูกเก็บไว้ใช้กับหน้าเว็บ
          จึงไม่ต้องเอารูป 64px ไปขยายจนเบลอ
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => void onPick(e.target.files?.[0])}
          style={{ fontSize: "0.9rem", color: "var(--muted)" }}
        />

        {picked ? (
          <div style={{ marginTop: "0.7rem" }}>
            <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.88rem" }}>
              {picked.file.name} · {picked.width}×{picked.height} ·{" "}
              {(picked.file.size / 1024).toFixed(0)} KB
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn" onClick={submit} disabled={pending}>
                {pending ? "กำลังอัปโหลด…" : "บันทึกไอคอน"}
              </button>
              <button type="button" className="btn" onClick={reset} disabled={pending}>
                ยกเลิก
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" style={{ margin: "0.6rem 0 0", fontSize: "0.88rem", color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}

        {result ? (
          <p
            role="status"
            style={{
              margin: "0.6rem 0 0",
              fontSize: "0.88rem",
              color: result.ok ? "var(--ok)" : "var(--danger)",
            }}
          >
            {result.message}
          </p>
        ) : null}

        {current?.updatedAt ? (
          <p className="faint" style={{ margin: "0.5rem 0 0", fontSize: "0.82rem" }}>
            อัปเดตล่าสุด {current.updatedAt}
            {current.updatedBy ? (
              <>
                {" "}
                โดย <code className="mono">{current.updatedBy}</code>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Preview({
  label,
  src,
  emptyText,
  highlight,
}: {
  label: string;
  src: string | null;
  emptyText: string;
  highlight?: boolean;
}) {
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <div
        style={{
          width: 64,
          height: 64,
          border: `1px ${src ? "solid" : "dashed"} ${highlight ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "var(--radius)",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        {src ? (
          // Deliberately not next/image: the optimizer pulls in sharp, which is
          // exactly the dependency the browser-side resize exists to avoid.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" width={64} height={64} style={{ display: "block" }} />
        ) : (
          <span className="faint" style={{ fontSize: "0.68rem", textAlign: "center", padding: "0 0.2rem" }}>
            {emptyText}
          </span>
        )}
      </div>
      <figcaption className="faint" style={{ fontSize: "0.76rem" }}>
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * Downscale to exactly 64x64 PNG.
 *
 * Halving repeatedly before the final step: a single 1024 -> 64 draw throws
 * away most source pixels and aliases badly on the pixel art these icons
 * usually are. Stepping down averages them instead, which is the difference
 * between a readable icon and mush in a server list.
 */
async function toIcon64(bitmap: ImageBitmap): Promise<Blob | null> {
  let canvas = document.createElement("canvas");
  let w = bitmap.width;
  let h = bitmap.height;
  canvas.width = w;
  canvas.height = h;
  let ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0);

  while (w > 128) {
    const nw = Math.max(64, Math.round(w / 2));
    const nh = Math.max(64, Math.round(h / 2));
    const next = document.createElement("canvas");
    next.width = nw;
    next.height = nh;
    const nctx = next.getContext("2d");
    if (!nctx) return null;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(canvas, 0, 0, nw, nh);
    canvas = next;
    ctx = nctx;
    w = nw;
    h = nh;
  }

  const final = document.createElement("canvas");
  final.width = 64;
  final.height = 64;
  const fctx = final.getContext("2d");
  if (!fctx) return null;
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = "high";
  fctx.drawImage(canvas, 0, 0, 64, 64);

  return new Promise((resolve) => final.toBlob(resolve, "image/png"));
}
