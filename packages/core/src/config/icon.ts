/**
 * Server Icon validation.
 *
 * This module exists because of one specific trap: Minecraft requires
 * server-icon.png to be EXACTLY 64x64, and silently ignores any other size.
 * No error, no log line, nothing in the server list. An admin uploads a 128px
 * image, sees a success message, and is simply wrong for as long as nobody
 * looks. So the size is verified from the actual PNG header bytes, on the
 * server, before anything is stored - never from a filename, a Content-Type,
 * or a promise made by the browser that produced the file.
 *
 * The resize itself happens in the browser (see IconUpload). That keeps a
 * native image library, and its resident memory, out of a web container capped
 * at 384 MB (ADR-0012 budgets this Host tightly). The contract enforced here is
 * "icon_64 is a PNG measuring 64x64", not "the server did the resizing" - so
 * swapping in a server-side encoder later changes nothing in this file.
 *
 * Deliberately dependency-free. Reading two big-endian integers out of a
 * header is not worth an image library on a memory budget.
 */

export const ICON_SIZE = 64;

/** The admin's source image. Generous, but not a memory hazard to read. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/**
 * A 64x64 PNG is a few KB. This cap is not about disk - it is a sanity bound
 * on something the client produced, applied before we parse it.
 */
export const MAX_ICON64_BYTES = 256 * 1024;

/** Formats we can measure from bytes. Anything else fails closed. */
export type SourceFormat = "png" | "jpeg" | "webp";

export const MIME_FOR: Readonly<Record<SourceFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Rejection carrying a message meant to be shown to the admin, in Thai. */
export class IconError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IconError";
  }
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface SourceImage extends ImageSize {
  readonly format: SourceFormat;
  readonly mime: string;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = at; i < at + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * PNG: signature, then a length, then the literal chunk type IHDR, then width
 * and height as big-endian uint32. The spec requires IHDR to be the first
 * chunk, so if it is not there this is not a PNG worth trusting.
 */
export function readPngSize(bytes: Uint8Array): ImageSize | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  const v = view(bytes);
  return { width: v.getUint32(16, false), height: v.getUint32(20, false) };
}

/**
 * JPEG: walk the marker chain to the frame header. Height comes BEFORE width,
 * which is the detail this parser gets wrong if written from memory.
 */
export function readJpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const v = view(bytes);
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1]!;
    // Fill bytes: any number of 0xFF may pad the front of a marker.
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1]!;
    }
    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = v.getUint16(i + 2, false);
    if (length < 2) return null;
    // SOF0..SOF15, minus DHT (C4), JPG (C8) and DAC (CC), which are not frames.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > bytes.length) return null;
      return { height: v.getUint16(i + 5, false), width: v.getUint16(i + 7, false) };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * WebP: three sub-formats, three different places the dimensions live. All
 * little-endian, and the two extended forms store the value MINUS ONE, which
 * is the classic off-by-one here.
 */
export function readWebpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const v = view(bytes);
  const chunk = ascii(bytes, 12, 4);

  if (chunk === "VP8 ") {
    // Lossy: frame tag (3 bytes), sync code 9D 01 2A, then 14-bit dimensions.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: v.getUint16(26, true) & 0x3fff,
      height: v.getUint16(28, true) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = v.getUint32(21, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }

  if (chunk === "VP8X") {
    const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }

  return null;
}

/**
 * What is this actually, by its bytes?
 *
 * The browser's declared Content-Type is not consulted anywhere. A caller may
 * claim any MIME it likes; the magic bytes decide, and an unrecognised format
 * is a rejection rather than a guess.
 */
export function detectFormat(bytes: Uint8Array): SourceFormat | null {
  if (isPng(bytes)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return null;
}

export function readImageSize(bytes: Uint8Array): (ImageSize & { format: SourceFormat }) | null {
  const format = detectFormat(bytes);
  if (!format) return null;
  const size =
    format === "png"
      ? readPngSize(bytes)
      : format === "jpeg"
        ? readJpegSize(bytes)
        : readWebpSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return { ...size, format };
}

/**
 * Validate the admin's source image.
 *
 * Non-square is rejected rather than cropped. Cropping silently would replace
 * the trap this feature removes with a different one: a success message and an
 * image that is not the image they chose. One pixel of tolerance is allowed
 * because a real editor can export 1001x1000 and refusing that helps nobody.
 */
export function assertSource(bytes: Uint8Array): SourceImage {
  if (bytes.length === 0) throw new IconError("ไฟล์ว่าง");
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new IconError(
      `ไฟล์ใหญ่เกินไป ${(bytes.length / 1024 / 1024).toFixed(1)} MB — ` +
        `จำกัดไว้ที่ ${MAX_SOURCE_BYTES / 1024 / 1024} MB`,
    );
  }

  const measured = readImageSize(bytes);
  if (!measured) {
    throw new IconError("อ่านรูปไม่ได้ — รับเฉพาะ PNG, JPEG หรือ WebP ที่ไม่เสียหาย");
  }

  if (Math.abs(measured.width - measured.height) > 1) {
    throw new IconError(
      `รูปต้องเป็นสี่เหลี่ยมจัตุรัส แต่ไฟล์นี้ขนาด ${measured.width}×${measured.height} — ` +
        `ระบบไม่ crop ให้เอง เพราะรูปที่ถูกตัดเงียบ ๆ ก็คือรูปที่คุณไม่ได้เลือก`,
    );
  }

  if (measured.width < ICON_SIZE) {
    throw new IconError(
      `รูปเล็กกว่า ${ICON_SIZE}×${ICON_SIZE} (${measured.width}×${measured.height}) — ` +
        `ย่อเป็นไอคอนได้ แต่จะเบลอบนหน้าเว็บ ใช้รูปที่ละเอียดกว่านี้`,
    );
  }

  return {
    format: measured.format,
    mime: MIME_FOR[measured.format],
    width: measured.width,
    height: measured.height,
  };
}

/**
 * Validate the 64x64 derivative - the one check that actually protects players
 * from an icon that never appears.
 *
 * This runs on the bytes as received. Whatever the browser claimed to produce
 * is irrelevant: a crafted request posting a 128x128 PNG as the derivative is
 * refused here, and nothing reaches the disk.
 */
export function assertIcon64(bytes: Uint8Array): void {
  if (bytes.length === 0) throw new IconError("ไม่ได้รับไฟล์ไอคอน 64×64 ที่ย่อไว้");
  if (bytes.length > MAX_ICON64_BYTES) {
    throw new IconError(`ไอคอน 64×64 ใหญ่ผิดปกติ (${bytes.length} ไบต์) — ไม่รับไว้`);
  }

  const size = readPngSize(bytes);
  if (!size) {
    throw new IconError("ไอคอนที่ย่อมาไม่ใช่ไฟล์ PNG ที่ถูกต้อง");
  }
  if (size.width !== ICON_SIZE || size.height !== ICON_SIZE) {
    throw new IconError(
      `ไอคอนต้องเป็น ${ICON_SIZE}×${ICON_SIZE} พอดี แต่ได้ ${size.width}×${size.height} — ` +
        `Minecraft เมินไฟล์ขนาดอื่นแบบเงียบ ๆ ระบบจึงไม่ยอมเขียนลงดิสก์`,
    );
  }
}
