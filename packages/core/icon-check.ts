/**
 * Verification for the Server Icon validators - `npm run icon:check`.
 *
 * The check in src/config/icon.ts is the only thing standing between an admin
 * and Minecraft's silent rejection of a wrongly-sized icon. It walks JPEG
 * marker chains and unpacks WebP's minus-one 14-bit dimensions by hand, which
 * is exactly the kind of code that rots without something exercising it.
 *
 * Inputs are byte buffers whose dimensions are known by construction. That is
 * not a stand-in for a real file: these parsers read headers and nothing else,
 * so a hand-built header IS the real input. Needs no database and no network.
 */
import {
  assertIcon64,
  assertSource,
  detectFormat,
  IconError,
  readImageSize,
} from "./src/config/icon.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  // Key order is an artifact of how each parser builds its result, not a fact
  // about the image. Compare the values, not the object literal's shape.
  const stable = (x: unknown) =>
    JSON.stringify(x, (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([l], [r]) => (l < r ? -1 : 1)))
        : v,
    );
  const a = stable(actual);
  const e = stable(expected);
  if (a === e) {
    console.log(`  ok   ${name} -> ${a}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n         got      ${a}\n         expected ${e}`);
  }
}

/** A PNG with a real IHDR and enough trailing bytes to look like a file. */
function png(width: number, height: number, pad = 64): Uint8Array {
  const b = new Uint8Array(24 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13, false); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  v.setUint32(16, width, false);
  v.setUint32(20, height, false);
  return b;
}

/** JPEG: APP0 first, then an SOF0 carrying height-before-width. */
function jpeg(width: number, height: number): Uint8Array {
  const b = new Uint8Array(4 + 18 + 11 + 8);
  const v = new DataView(b.buffer);
  let i = 0;
  b[i++] = 0xff; b[i++] = 0xd8;              // SOI
  b[i++] = 0xff; b[i++] = 0xe0;              // APP0
  v.setUint16(i, 16, false); i += 16;        // length 16, contents ignored
  b[i++] = 0xff; b[i++] = 0xc0;              // SOF0
  v.setUint16(i, 11, false); i += 2;         // length
  b[i++] = 8;                                // precision
  v.setUint16(i, height, false); i += 2;     // HEIGHT first — the easy mistake
  v.setUint16(i, width, false); i += 2;      // then width
  return b;
}

/** WebP lossy: RIFF/WEBP/VP8 with the 9D 01 2A sync code. */
function webpLossy(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  const v = new DataView(b.buffer);
  const put = (s: string, at: number) => [...s].forEach((c, k) => (b[at + k] = c.charCodeAt(0)));
  put("RIFF", 0);
  v.setUint32(4, b.length - 8, true);
  put("WEBP", 8);
  put("VP8 ", 12);
  v.setUint32(16, b.length - 20, true);
  b[20] = 0x00; b[21] = 0x00; b[22] = 0x00;   // frame tag
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;   // sync code
  v.setUint16(26, width, true);
  v.setUint16(28, height, true);
  return b;
}

/** WebP lossless: the 14-bit-minus-one packing that invites an off-by-one. */
function webpLossless(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  const v = new DataView(b.buffer);
  const put = (s: string, at: number) => [...s].forEach((c, k) => (b[at + k] = c.charCodeAt(0)));
  put("RIFF", 0);
  v.setUint32(4, b.length - 8, true);
  put("WEBP", 8);
  put("VP8L", 12);
  v.setUint32(16, b.length - 20, true);
  b[20] = 0x2f;
  v.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  return b;
}

/** WebP extended: 24-bit canvas dimensions, also minus one. */
function webpExtended(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  const v = new DataView(b.buffer);
  const put = (s: string, at: number) => [...s].forEach((c, k) => (b[at + k] = c.charCodeAt(0)));
  const u24 = (value: number, at: number) => {
    b[at] = value & 0xff;
    b[at + 1] = (value >> 8) & 0xff;
    b[at + 2] = (value >> 16) & 0xff;
  };
  put("RIFF", 0);
  v.setUint32(4, b.length - 8, true);
  put("WEBP", 8);
  put("VP8X", 12);
  v.setUint32(16, 10, true);
  u24(width - 1, 24);
  u24(height - 1, 27);
  return b;
}

function throws(name: string, fn: () => unknown, mustContain: string) {
  try {
    fn();
    failures++;
    console.log(`  FAIL ${name} — expected a rejection, got none`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof IconError && message.includes(mustContain)) {
      console.log(`  ok   ${name} -> rejected`);
    } else {
      failures++;
      console.log(`  FAIL ${name} — wrong rejection: ${message}`);
    }
  }
}

console.log("format sniffing (magic bytes, never the declared MIME)");
check("png", detectFormat(png(64, 64)), "png");
check("jpeg", detectFormat(jpeg(64, 64)), "jpeg");
check("webp", detectFormat(webpLossy(64, 64)), "webp");
check("garbage", detectFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);

console.log("\ndimensions");
check("png 1024x1024", readImageSize(png(1024, 1024)), { width: 1024, height: 1024, format: "png" });
check("png 64x64", readImageSize(png(64, 64)), { width: 64, height: 64, format: "png" });
check("jpeg 800x600", readImageSize(jpeg(800, 600)), { width: 800, height: 600, format: "jpeg" });
check("webp lossy 512x512", readImageSize(webpLossy(512, 512)), { width: 512, height: 512, format: "webp" });
check("webp lossless 300x200", readImageSize(webpLossless(300, 200)), { width: 300, height: 200, format: "webp" });
check("webp extended 4096x4096", readImageSize(webpExtended(4096, 4096)), { width: 4096, height: 4096, format: "webp" });

console.log("\nassertSource — the admin's upload");
check("1024x1024 accepted", assertSource(png(1024, 1024)).mime, "image/png");
check("1001x1000 tolerated", assertSource(png(1001, 1000)).width, 1001);
throws("16:9 rejected, not cropped", () => assertSource(png(1920, 1080)), "สี่เหลี่ยมจัตุรัส");
throws("32x32 too small", () => assertSource(png(32, 32)), "เล็กกว่า");
throws("5 MB over the cap", () => assertSource(png(1024, 1024, 5 * 1024 * 1024)), "ใหญ่เกินไป");
throws("not an image", () => assertSource(new Uint8Array(200)), "อ่านรูปไม่ได้");
throws("empty", () => assertSource(new Uint8Array(0)), "ว่าง");

console.log("\nassertIcon64 — the check that protects players");
check("64x64 accepted", assertIcon64(png(64, 64)), undefined);
throws("128x128 refused", () => assertIcon64(png(128, 128)), "64×64 พอดี");
throws("63x64 refused", () => assertIcon64(png(63, 64)), "64×64 พอดี");
throws("a JPEG claiming to be the icon", () => assertIcon64(jpeg(64, 64)), "ไม่ใช่ไฟล์ PNG");

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
