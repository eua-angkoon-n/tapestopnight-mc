-- The milestone allowlist: what is worth interrupting a Discord channel for.
--
-- SOURCE, not generated output. This is policy — somebody decided that killing
-- Asmodeus deserves a message and mining a thousand stone does not — and policy
-- belongs in review, the same argument that keeps the Edit Tiers in TypeScript.
--
-- ── Where these ids came from ────────────────────────────────────────────────
--
-- Not from memory and not from a wiki. Extracted from the pack's own
-- config/betterquesting/DefaultQuests.json on the Host by reading every
-- `bq_standard:hunt` task and its `target:8` entity — 22 of them, of which the
-- ones below are the fights people talk about. The quest id and the entity id
-- in each pair therefore describe the same kill, from the two different angles
-- the bridge can see it from:
--
--   kind='quest'  the player had the quest and completed it
--   kind='kill'   the statistics file counted the kill, quest or no quest
--
-- Both are seeded on purpose. A player who never opened the quest book still
-- killed the dragon.
--
-- ── Why advancements are not in this file ───────────────────────────────────
--
-- Because they do not exist here. config/fermiummixins.cfg ships
-- "Nuke Advancements (Vanilla)"=true, which unloads the advancement system
-- entirely, and DregoraRL/advancements/<uuid>.json on the Host is `{}`.
-- announceAdvancements=true in globalgamerules.cfg is announcing nothing.
-- → docs/adr/0015-chat-bridge-via-log-tail.md
--
-- Labels are Thai because the pack ships no server-side translations at all:
-- quest names in DefaultQuests.json are lang keys (betterquesting.quest.name.N)
-- and there is no .lang file anywhere on the Host to resolve them. Writing the
-- twenty that matter by hand is cheaper than shipping a translation table for
-- all 403.
--
-- Applied with (no new tooling — it is plain SQL on purpose):
--   docker exec -i tapestopnight-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
--     < db/seed/0002-milestones.sql
--
-- Re-running is safe: it updates labels and re-enables rows, and never touches
-- player_milestone, so nothing already announced is announced again.

BEGIN;

INSERT INTO notable_milestone (kind, key, label) VALUES
  -- ── the dragons ──────────────────────────────────────────────────────────
  ('quest', '20',  'ล้มมังกรไฟตัวแรกได้แล้ว 🔥'),
  ('quest', '24',  'ล้มมังกรน้ำแข็งตัวแรกได้แล้ว ❄️'),
  ('quest', '51',  'ปราบ Ender Dragon สำเร็จ'),
  ('kill',  'iceandfire:firedragon', 'ฆ่ามังกรไฟได้ 🔥'),
  ('kill',  'iceandfire:icedragon',  'ฆ่ามังกรน้ำแข็งได้ ❄️'),
  ('kill',  'minecraft:ender_dragon', 'ฆ่า Ender Dragon ได้'),

  -- ── the Lycanites bosses: the fights this pack is actually about ─────────
  ('quest', '187', 'ปราบ Rahovart สำเร็จ 👹'),
  ('quest', '192', 'ปราบ Asmodeus สำเร็จ 👹'),
  ('quest', '278', 'ปราบ Amalgalich สำเร็จ 💀'),
  ('kill',  'lycanitesmobs:rahovart',   'ฆ่า Rahovart ได้ 👹'),
  ('kill',  'lycanitesmobs:asmodeus',   'ฆ่า Asmodeus ได้ 👹'),
  ('kill',  'lycanitesmobs:amalgalich', 'ฆ่า Amalgalich ได้ 💀'),

  -- ── the SR Parasites end-game ────────────────────────────────────────────
  ('quest', '383', 'ปราบ Simulacrum Dragon สำเร็จ'),
  ('kill',  'srparasites:sim_dragone', 'ฆ่า Simulacrum Dragon ได้'),

  -- ── the Ice and Fire road there ──────────────────────────────────────────
  ('quest', '14',  'ล้ม Cyclops ตัวแรกได้'),
  ('quest', '6',   'ล้ม Gorgon ได้ — และยังไม่กลายเป็นหิน'),
  ('quest', '60',  'ล้ม Sea Serpent ได้ 🌊'),
  ('quest', '35',  'ล้ม Death Worm ได้ 🏜️'),
  ('quest', '37',  'ล้ม Cockatrice ได้'),
  ('quest', '2',   'ล้ม Troll ตัวแรกได้'),
  ('quest', '58',  'รอด Siren มาได้ 🎶'),
  ('quest', '8',   'ล้ม Stymphalian Bird ได้'),

  -- ── the odd ones out, kept because people enjoy them ─────────────────────
  ('quest', '107', 'ปราบ Book Wyrm ได้ 📖'),
  ('quest', '198', 'ล้ม Kobold ได้')
ON CONFLICT (kind, key) DO UPDATE SET label = EXCLUDED.label, enabled = TRUE;

COMMIT;
