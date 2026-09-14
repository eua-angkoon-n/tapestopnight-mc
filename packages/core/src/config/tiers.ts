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
 * ── What changed with Homestead, and what is still owed ──────────────────
 *
 * The previous table's claims were sourced from Dregora's own
 * "SERVER README OR DIE.txt" and named OpenTerrainGenerator, Ice and Fire's
 * fairy rings and RLCraft's difficulty balance. None of that exists here, so
 * carrying the reasons forward would have left an admin reading a confident
 * explanation of a mod that is not installed.
 *
 * The reasons below are therefore written from what is true of Minecraft
 * 1.20.1 and of Homestead in general. Where a number is a judgement rather
 * than a documented requirement it says so, instead of citing a readme that
 * was never read.
 *
 * What the pack's own server.properties actually ships, for the three that
 * were open questions: `view-distance=12`, `difficulty=normal`, and
 * `simulation-distance` is absent entirely — the pack's file is a 2020-era
 * template and predates the key, so the server will use its own default of 10.
 * The entry for it below is therefore dormant until somebody adds the key.
 *
 * Keys that simply stopped existing in 1.18+ (snooper-enabled,
 * max-build-height, texture-pack) have been dropped rather than re-tiered.
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
      "เปลี่ยนแล้วเซิร์ฟจะสร้างโลกใหม่ว่างเปล่า โลกเดิมกลายเป็นไฟล์ทิ้ง " +
      "เสียทั้ง progress ผู้เล่นและเวลาสร้างแผนที่ทั้งหมด กู้ไม่ได้",
  },
  "level-type": {
    tier: "LOCKED",
    reason:
      "Homestead วางภูมิประเทศผ่าน Tectonic และ TerraBlender บนพื้นฐานของ " +
      "minecraft:normal เปลี่ยนเป็น flat หรือ large_biomes แล้วไบโอมและ " +
      "โครงสร้างของ pack จะไม่ตรงกับโลกที่ผู้เล่นอยู่",
  },
  "max-tick-time": {
    tier: "LOCKED",
    reason:
      "ต้องเป็น -1 เพราะการสร้าง chunk ของ pack นี้ใช้เวลานานกว่าค่ามาตรฐาน " +
      "ถ้าตั้งค่าอื่น watchdog จะเข้าใจผิดว่าเซิร์ฟแครชแล้วฆ่าตัวเองกลางการเขียนโลก",
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
      "ต้องเป็น true ไม่งั้นผู้เล่นที่ใช้ elytra ขี่สัตว์บิน หรือของจาก mod ที่ " +
      "ทำให้ลอยตัว จะถูกเซิร์ฟเตะออกด้วยข้อหาโกง ทั้งที่เล่นตามปกติ",
  },
  "enable-command-block": {
    tier: "LOCKED",
    reason:
      "ต้องเป็น true เพราะโครงสร้างและรางวัลเควสต์ของ pack ใช้ command block " +
      "ปิดแล้วบางโครงสร้างจะสร้างไม่ครบและเควสต์บางอันจะให้ของไม่ได้",
  },
  "max-world-size": {
    tier: "LOCKED",
    reason:
      "กำหนดขอบเขตที่โลกสร้างต่อได้ ลดลงหลังจากผู้เล่นออกไปไกลแล้ว จะทำให้ " +
      "พื้นที่ที่สร้างไว้แล้วอยู่นอกขอบและเดินทางกลับเข้าไปไม่ได้",
  },
  "sync-chunk-writes": {
    tier: "LOCKED",
    reason:
      "ต้องเป็น true การปิดทำให้การเขียน chunk ไม่รอดิสก์ยืนยัน ซึ่งเร็วขึ้นจริง " +
      "แต่ไฟไหม้กลางคันเมื่อไหร่ region file เสียทั้งก้อน แลกไม่คุ้ม",
  },

  // ── GUARDED: legitimate to change, but needs a deliberate confirmation ──
  difficulty: {
    tier: "GUARDED",
    reason:
      "Homestead เป็น pack แนวอยู่สบาย ไม่ได้ปรับสมดุลรอบความยากสูงแบบ pack สาย " +
      "เอาชีวิตรอด เปลี่ยนได้ตามใจกลุ่มผู้เล่น แต่กระทบทุกคนบนเซิร์ฟพร้อมกัน",
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
      "ระยะที่เซิร์ฟส่ง chunk ให้ผู้เล่นเห็น เป็นตัวกินแรมและ CPU ที่ใหญ่ที่สุด " +
      "ตัวหนึ่ง เครื่องนี้มีแรมจำกัด เพิ่มแล้วควรดู TPS และ RSS ประกอบเสมอ",
  },
  "simulation-distance": {
    tier: "GUARDED",
    reason:
      "ระยะที่ของในโลกยังทำงานจริง — พืชโต เตาหลอม สัตว์เดิน ลดแล้วประหยัดแรง " +
      "เครื่องมาก แต่ฟาร์มที่อยู่ไกลผู้เล่นจะหยุดทำงานโดยไม่มีอะไรบอก",
  },
  "spawn-protection": {
    tier: "GUARDED",
    reason: "กำหนดว่าผู้เล่นทั่วไปแก้บล็อกรอบจุดเกิดได้ไกลแค่ไหน",
  },
  "white-list": {
    tier: "GUARDED",
    reason: "เปิดแล้วคนที่ไม่อยู่ในรายชื่อเข้าไม่ได้ทันที รวมถึงคนที่กำลังเล่นอยู่",
  },
  "enforce-whitelist": {
    tier: "GUARDED",
    reason:
      "เปิดแล้วคนที่ถูกถอดออกจาก whitelist จะถูกเตะออกทันทีระหว่างเล่น " +
      "ไม่ใช่แค่เข้าใหม่ไม่ได้",
  },
  gamemode: {
    tier: "GUARDED",
    reason:
      "survival คือโหมดที่ pack ออกแบบมา เปลี่ยนเป็น creative จะทำให้ทั้งเซิร์ฟ " +
      "ได้ของฟรีหมดและเควสต์เสียความหมาย",
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
      "เนเธอร์เป็นส่วนหนึ่งของเส้นทางความก้าวหน้าและของเควสต์หลายอัน " +
      "ปิดแล้วผู้เล่นจะตันกลางเกมโดยไม่มีอะไรอธิบายว่าทำไม",
  },
  "op-permission-level": {
    tier: "GUARDED",
    reason: "กำหนดว่า op ทำอะไรได้บ้าง ลดแล้วคำสั่งจัดการเซิร์ฟบางส่วนจะใช้ไม่ได้",
  },
  "function-permission-level": {
    tier: "GUARDED",
    reason:
      "ระดับสิทธิ์ที่ datapack function รันได้ ลดแล้วเควสต์และโครงสร้างที่เรียก " +
      "คำสั่งระดับสูงจะเงียบ ๆ ทำงานไม่ครบ",
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
  "enforce-secure-profile": {
    tier: "GUARDED",
    reason:
      "บังคับให้ข้อความแชทมีลายเซ็นของ Mojang ปิดแล้วผู้เล่นที่ใช้ mod แชท " +
      "บางตัวจะเข้าได้ราบรื่นขึ้น แต่เซิร์ฟจะยืนยันไม่ได้ว่าใครพิมพ์อะไรจริง",
  },

  // ── FREE: cosmetic or routine ──
  "network-compression-threshold": {
    tier: "FREE",
    reason: "ขนาดแพ็กเก็ตที่เริ่มบีบอัด เป็นการจูนประสิทธิภาพ ไม่กระทบกติกาเกม",
  },
  "entity-broadcast-range-percentage": {
    tier: "FREE",
    reason:
      "ระยะที่ผู้เล่นเห็นสัตว์และของที่ตกอยู่ ลดแล้วเบาเครื่องขึ้นและไม่กระทบ " +
      "กติกา แค่ของจะโผล่ให้เห็นตอนเข้าใกล้กว่าเดิม",
  },
  "hide-online-players": {
    tier: "FREE",
    reason:
      "ซ่อนรายชื่อผู้เล่นจากหน้ารายการเซิร์ฟ — หน้าเว็บและบอทอ่านจากที่นี่ " +
      "เปิดแล้วทั้งสองที่จะไม่มีรายชื่อให้แสดง",
  },
  "broadcast-rcon-to-ops": {
    tier: "FREE",
    reason: "ส่งผลลัพธ์คำสั่งที่มาทาง RCON ให้ op เห็นในเกม",
  },
  motd: { tier: "FREE", reason: "ข้อความที่แสดงในหน้ารายการเซิร์ฟของผู้เล่น" },
  "max-players": {
    tier: "FREE",
    reason:
      "จำนวนผู้เล่นพร้อมกันสูงสุด เครื่องนี้รัน heap 8 GB ซึ่งเป็นเพดานของ Host " +
      "ไม่ใช่ค่าที่เหลือเฟือ ตั้งสูงได้แต่ควรดู TPS และ RSS ประกอบ",
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
 * The keys 1.20.1 ships that are deliberately LEFT to this default, and why:
 *
 *   level-seed, generator-settings, generate-structures
 *       Load-bearing for how the world was built. Changing any of them risks a
 *       world that generates differently from the one players are living in.
 *   initial-enabled-packs, initial-disabled-packs
 *       Which datapacks the world starts with. Homestead ships quests and
 *       worldgen as datapacks; turning one off mid-world is not a setting, it
 *       is a content removal.
 *   server-ip
 *       Must stay empty so the server binds every interface inside the
 *       container. Setting it is a fast way to make the port unreachable.
 *   use-native-transport
 *       Linux epoll transport. Disabling it costs performance for no gain.
 *   resource-pack, resource-pack-sha1, resource-pack-prompt,
 *   require-resource-pack
 *       Serving a resource pack is a reasonable future feature, but a wrong
 *       sha1 stops clients joining outright. Locked until something actually
 *       wires it up.
 *   rate-limit, text-filtering-config, log-ips, enable-jmx-monitoring
 *       Operational knobs with no in-game meaning, and log-ips in particular
 *       interacts with the address matching Player Link depends on (ADR-0016).
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
