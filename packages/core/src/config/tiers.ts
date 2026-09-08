/**
 * The Edit Tier table — ADR-0003.
 *
 * This is policy, which is why it lives in source rather than only in the
 * database: a tier change should arrive through review, not through an UPDATE.
 * The seeder reads it, and the admin UI reads it to render each field.
 *
 * `reason` is user-facing. For a LOCKED key it answers "why can't I change
 * this?", and ADR-0003 keeps locked keys visible precisely so that an admin
 * reads the answer instead of going to look for the file over SSH.
 *
 * Every claim below comes from the pack's own SERVER README OR DIE.txt.
 */

export type Tier = "FREE" | "GUARDED" | "LOCKED";

export interface TierRule {
  readonly tier: Tier;
  readonly reason: string;
}

/** Anything absent from this map is LOCKED. Fail closed (ADR-0003). */
export const TIERS: Readonly<Record<string, TierRule>> = {
  // ── LOCKED: changing these destroys the world or the control plane ──
  "level-name": {
    tier: "LOCKED",
    reason:
      "เปลี่ยนแล้ว Forge จะสร้างโลกใหม่ว่างเปล่า โลกเดิมกลายเป็นไฟล์ทิ้ง " +
      "เสียทั้ง progress ผู้เล่นและเวลา pre-generation ทั้งหมด กู้ไม่ได้",
  },
  "level-type": {
    tier: "LOCKED",
    reason:
      "ต้องเป็น OTG เพื่อให้ OpenTerrainGenerator ทำงาน ถ้าเปลี่ยน โลกจะกลับไปใช้ " +
      "generation แบบวานิลลา ภูมิประเทศ Dregora หายทั้งหมด",
  },
  "max-tick-time": {
    tier: "LOCKED",
    reason:
      "ต้องเป็น -1 เพราะโครงสร้างใหญ่ของ OTG ใช้เวลาสร้างเป็นนาที ถ้าตั้งค่าอื่น " +
      "Forge จะเข้าใจผิดว่าเซิร์ฟแครชแล้วฆ่าตัวเองกลางการสร้างโลก",
  },
  "server-port": {
    tier: "LOCKED",
    reason:
      "ผูกกับ SRV record บน Cloudflare และกฎ ufw บนเครื่อง เปลี่ยนที่นี่ที่เดียว " +
      "ผู้เล่นจะเข้าไม่ได้ทั้งหมด",
  },
  "enable-rcon": {
    tier: "LOCKED",
    reason:
      "ปิดแล้วบอท Discord และปุ่ม Apply จะสั่งงานเซิร์ฟไม่ได้เลย — " +
      "เท่ากับปิดระบบควบคุมทั้งระบบ",
  },
  "rcon.password": {
    tier: "LOCKED",
    reason: "ตั้งจาก .env บนเครื่องเท่านั้น ไม่แก้ผ่านเว็บ",
  },
  "rcon.port": {
    tier: "LOCKED",
    reason: "ใช้ภายใน Docker network เท่านั้น ไม่เคย publish ออกอินเทอร์เน็ต",
  },
  "allow-flight": {
    tier: "LOCKED",
    reason:
      "ต้องเป็น true ไม่งั้นผู้เล่นที่ขี่สัตว์บินหรือใช้ fairy ring จะถูกเซิร์ฟเตะออก",
  },
  "enable-command-block": {
    tier: "LOCKED",
    reason: "ต้องเป็น true ไม่งั้น villager จะไม่ spawn ในโครงสร้างที่ generate ขึ้นมา",
  },
  "max-world-size": {
    tier: "LOCKED",
    reason:
      "ลดต่ำกว่า 20,000 แล้ว teleporter ในเกมจะพัง ตามที่ readme ของ modpack เตือนไว้",
  },

  // ── GUARDED: legitimate to change, but needs a deliberate confirmation ──
  difficulty: {
    tier: "GUARDED",
    reason: "RLCraft ปรับสมดุลมาบนความยาก 3 ลดแล้วเกมจะง่ายกว่าที่ผู้ออกแบบตั้งใจ",
  },
  pvp: {
    tier: "GUARDED",
    reason: "เปลี่ยนกติกาการเล่นของทุกคนบนเซิร์ฟทันที",
  },
  "online-mode": {
    tier: "GUARDED",
    reason:
      "ปิดแล้วใครก็สวมรอยเป็นชื่อใครก็ได้ รวมถึงชื่อแอดมิน เปิดไว้เสมอ " +
      "ยกเว้นมีเหตุผลที่เข้าใจผลกระทบเต็มที่",
  },
  "view-distance": {
    tier: "GUARDED",
    reason:
      "readme ระบุว่า 10 คือค่าที่เข้ากันได้เต็มที่ ลดเป็น 8 หรือ 6 ประหยัดแรมได้ " +
      "แต่ทำให้ระบบ spawn/despawn มอนสเตอร์เพี้ยน",
  },
  "spawn-protection": {
    tier: "GUARDED",
    reason: "กำหนดว่าผู้เล่นทั่วไปแก้บล็อกรอบจุดเกิดได้ไกลแค่ไหน",
  },
  "white-list": {
    tier: "GUARDED",
    reason: "เปิดแล้วคนที่ไม่อยู่ในรายชื่อเข้าไม่ได้ทันที รวมถึงคนที่กำลังเล่นอยู่",
  },

  gamemode: {
    tier: "GUARDED",
    reason:
      "0 = survival ซึ่งเป็นโหมดที่ RLCraft ออกแบบมา เปลี่ยนเป็น creative " +
      "จะทำให้ทั้งเซิร์ฟได้ของฟรีหมด",
  },
  hardcore: {
    tier: "GUARDED",
    reason:
      "เปิดแล้วผู้เล่นที่ตายจะถูกแบนถาวรจากโลกนั้น เป็นการเปลี่ยนกติกาที่ " +
      "ย้อนความเสียหายให้ผู้เล่นไม่ได้",
  },
  "force-gamemode": {
    tier: "GUARDED",
    reason: "บังคับโหมดเกมของผู้เล่นทุกคนตอนเข้าเซิร์ฟ ทับค่าที่แต่ละคนเคยเป็น",
  },
  "allow-nether": {
    tier: "GUARDED",
    reason:
      "Dregora มีเนเธอร์ที่ออกแบบเองและ RLCraft ใช้เนเธอร์เป็นส่วนหนึ่งของ " +
      "เส้นทางความก้าวหน้า ปิดแล้วผู้เล่นจะตันกลางเกม",
  },
  "op-permission-level": {
    tier: "GUARDED",
    reason: "กำหนดว่า op ทำอะไรได้บ้าง ลดแล้วคำสั่งจัดการเซิร์ฟบางส่วนจะใช้ไม่ได้",
  },
  "enable-query": {
    tier: "GUARDED",
    reason:
      "เปิดแล้วต้องเปิดพอร์ต UDP ใน ufw ด้วยถึงจะใช้ได้ และระบบสถานะของเราใช้ " +
      "Server List Ping อยู่แล้วจึงไม่จำเป็น",
  },
  "prevent-proxy-connections": {
    tier: "GUARDED",
    reason: "เปิดแล้วผู้เล่นที่ต่อผ่าน VPN บางแบบจะเข้าไม่ได้",
  },

  // ── FREE: cosmetic or routine ──
  "network-compression-threshold": {
    tier: "FREE",
    reason: "ขนาดแพ็กเก็ตที่เริ่มบีบอัด เป็นการจูนประสิทธิภาพ ไม่กระทบกติกาเกม",
  },
  "snooper-enabled": {
    tier: "FREE",
    reason: "ส่งสถิติการใช้งานให้ Mojang ปิดไว้ก็ได้ ไม่กระทบอะไร",
  },

  motd: { tier: "FREE", reason: "ข้อความที่แสดงในหน้ารายการเซิร์ฟของผู้เล่น" },
  "max-players": {
    tier: "FREE",
    reason:
      "จำนวนผู้เล่นพร้อมกันสูงสุด เครื่องนี้รัน heap 7 GB (ADR-0012) " +
      "ซึ่งรองรับได้สบายราว 10-15 คน ตั้งสูงกว่านั้นได้แต่ควรดู TPS ประกอบ",
  },
  "player-idle-timeout": {
    tier: "FREE",
    reason: "เตะผู้เล่นที่ไม่ขยับออกหลังกี่นาที (0 = ไม่เตะ)",
  },
  "spawn-monsters": { tier: "FREE", reason: "เปิด/ปิดการเกิดมอนสเตอร์" },
  "spawn-animals": { tier: "FREE", reason: "เปิด/ปิดการเกิดสัตว์" },
  "spawn-npcs": { tier: "FREE", reason: "เปิด/ปิดการเกิด villager" },
  "broadcast-console-to-ops": {
    tier: "FREE",
    reason: "ส่งข้อความ console ให้ op เห็นในเกม",
  },
} as const;

/**
 * Fail closed: an unrecognised key is LOCKED, per ADR-0003.
 *
 * The keys the pack ships that are deliberately LEFT to this default, and why:
 *
 *   level-seed, generator-settings, generate-structures, hellworld
 *       Load-bearing for how OTG builds Dregora. Changing any of them risks a
 *       world that generates differently from the one players are living in.
 *   max-build-height
 *       1.12.2 cannot exceed 256, and lowering it strands anything built above.
 *   server-ip
 *       Must stay empty so the server binds every interface inside the
 *       container. Setting it is a fast way to make the port unreachable.
 *   use-native-transport
 *       Linux epoll transport. Disabling it costs performance for no gain.
 *   resource-pack, resource-pack-sha1, texture-pack
 *       Serving a resource pack is a reasonable future feature, but a wrong
 *       sha1 stops clients joining outright, and this project deleted the
 *       pack's client-side resources/ tree as unused (ADR-0009). Locked until
 *       something actually wires it up.
 */
export function tierFor(key: string): TierRule {
  return (
    TIERS[key] ?? {
      tier: "LOCKED",
      reason:
        "คีย์นี้ยังไม่ได้จัดระดับไว้ ระบบจึงล็อกไว้โดยปริยายเพื่อความปลอดภัย " +
        "ถ้าต้องการให้แก้ได้ ต้องเพิ่มลง TIERS ในโค้ดผ่านการรีวิว",
    }
  );
}

export function isEditable(key: string): boolean {
  return tierFor(key).tier !== "LOCKED";
}
