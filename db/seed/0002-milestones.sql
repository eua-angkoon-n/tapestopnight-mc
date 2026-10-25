-- The milestone allowlist: what is worth interrupting a Discord channel for.
--
-- SOURCE, not generated output. This is policy — somebody decided that taming
-- your first animal deserves a message and mining a thousand stone does not —
-- and policy belongs in review, the same argument that keeps the Edit Tiers in
-- TypeScript.
--
-- ── What changed with ATM10 To the Sky (2026-10-25) ────────────────────────
--
-- The pack before this one was Homestead, a cozy farming pack, and this list
-- was built around it. ATM10 To the Sky is a skyblock: everyone starts on an
-- island in the void, and the story is Ex Deorum sieving, then tech —
-- Mekanism, Applied Energistics 2, Create. The farming line is trimmed, the
-- "go explore the biomes" line is gone (adventuring_time cannot happen in a
-- void world worth announcing), and the tech milestones are what people will
-- actually say out loud.
--
-- Homestead's own namespaces (cozystudioscore, duckling) are deleted below:
-- those mods are not installed, so those rows can never match. Farmer's
-- Delight IS in this pack, and its ids were re-checked against the 2.2.0 jar,
-- so its rows stay.
--
-- The kinds:
--
--   kind='advancement'  the id in <world>/advancements/<uuid>.json, `done:true`
--   kind='kill'         the statistics file counted the kill
--
-- ── Where these ids came from ──────────────────────────────────────────────
--
-- Vanilla 1.21.1 ids come from the game itself and exist on any server. The
-- pack's own ids were read out of the server pack's jars, not guessed: every
-- `data/<namespace>/advancement(s)/**.json` across all 322 mod jars, minus the
-- recipe tree — about 1,900 real advancements across 46 namespaces, of which
-- only a handful are seeded. The rule applied was "would somebody say this out
-- loud in chat". To add more later:
--
--   docker exec tapestopnight-mc --     sh -c 'cat /data/atm10sky/advancements/*.json' | grep -o '"[a-z_]*:[a-z_/]*"' --     | sort -u | grep -v '^"minecraft:recipes'
--
-- ⚠ The Thai labels for the pack's own advancements are written from the
-- advancement ID, because the jars hold ids and there is no server-side
-- translation to resolve them against. They describe what the id says and no
-- more — if one reads oddly in Discord, the id was ambiguous, not the player.
--
-- Adding a row later is safe and does the right thing: the scanner only
-- records what is on the allowlist, so an advancement added here afterwards is
-- announced the next time the scan sees it, even for players who finished it
-- weeks ago.
--
-- Labels are Thai because the pack ships no server-side translations — the
-- files hold ids, not display names, and there is nothing on the Host to
-- resolve them against. Writing the ones that matter by hand is cheaper than
-- shipping a translation table for all of them.
--
-- Applied with (no new tooling — it is plain SQL on purpose):
--   docker exec -i tapestopnight-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
--     < db/seed/0002-milestones.sql
--
-- Re-running is safe: it updates labels and re-enables rows, and never touches
-- player_milestone, so nothing already announced is announced again.

BEGIN;

-- The Dregora allowlist, removed rather than left disabled. A row that can
-- never match is not a setting somebody might want back; it is a puzzle for
-- whoever reads this table next.
--
-- Narrow on purpose. Every 'quest' row was a Better Questing id and that mod
-- is gone, so the kind is empty by definition. The 'kill' kind still works, so
-- only the rows naming mods that are no longer installed go — an operator who
-- added a kill row by hand keeps it.
DELETE FROM notable_milestone WHERE kind = 'quest';
DELETE FROM notable_milestone
 WHERE kind = 'kill'
   AND key NOT LIKE 'minecraft:%';

-- Homestead's, and the vanilla rows that only made sense on it. Already
-- announced milestones live in player_milestone and are not touched.
DELETE FROM notable_milestone
 WHERE kind = 'advancement'
   AND (key LIKE 'cozystudioscore:%'
     OR key LIKE 'duckling:%'
     OR key IN ('minecraft:story/mine_stone',
                'minecraft:story/smelt_iron',
                'minecraft:story/obtain_armor',
                'minecraft:story/enchant_item',
                'minecraft:husbandry/plant_seed',
                'minecraft:husbandry/breed_an_animal',
                'minecraft:husbandry/breed_all_animals',
                'minecraft:husbandry/balanced_diet',
                'minecraft:husbandry/silk_touch_nest',
                'minecraft:husbandry/netherite_hoe',
                'minecraft:adventure/trade',
                'minecraft:nether/find_fortress',
                'minecraft:nether/obtain_blaze_rod',
                'minecraft:adventure/adventuring_time',
                'minecraft:adventure/totem_of_undying',
                'farmersdelight:main/get_rich_soil',
                'farmersdelight:main/obtain_netherite_knife'));

INSERT INTO notable_milestone (kind, key, label) VALUES
  -- ── off the island: the first hours everyone shares ─────────────────────
  -- `exdeorum:core/root` is deliberately absent: a root advancement is
  -- granted on arrival, so announcing it would congratulate people for joining.
  ('advancement', 'exdeorum:core/crook',        'ทำไม้เขี่ย (Crook) อันแรกแล้ว 🪝'),
  ('advancement', 'exdeorum:core/barrel',       'ตั้งถังหมักแรกแล้ว 🛢️'),
  ('advancement', 'exdeorum:core/string_mesh',  'ได้ตะแกรงร่อนชิ้นแรก — เริ่มร่อนหาแร่ได้แล้ว'),
  ('advancement', 'minecraft:story/mine_diamond',      'เจอเพชรแล้ว 💎'),
  ('advancement', 'minecraft:husbandry/tame_an_animal', 'มีเพื่อนสัตว์เลี้ยงตัวแรกแล้ว 🐾'),

  -- ── tech: what this pack is actually about ──────────────────────────────
  ('advancement', 'ae2:main/controller',        'สร้าง ME Controller แล้ว ระบบ AE2 เริ่มเดิน 💾'),
  ('advancement', 'ae2:main/qnb',               'ทำ Quantum Network Bridge ได้แล้ว'),
  ('advancement', 'mekanism:steel_ingot',       'ได้เหล็กกล้า (Steel) แท่งแรกจาก Mekanism'),
  ('advancement', 'mekanism:digital_miner',     'สร้าง Digital Miner แล้ว ⛏️'),
  ('advancement', 'mekanism:teleporter',        'สร้าง Teleporter ได้แล้ว 🌀'),
  ('advancement', 'mekanism:mekasuit',          'ใส่ MekaSuit แล้ว 🦾'),
  ('advancement', 'mekanism:sps',               'เดินเครื่อง SPS ได้แล้ว'),
  ('advancement', 'mekanism:antimatter',        'ผลิต Antimatter ได้แล้ว ⚛️'),
  ('advancement', 'create:steam_engine',        'เดินเครื่องจักรไอน้ำของ Create ได้แล้ว 🚂'),
  ('advancement', 'create:train',               'สร้างรถไฟขบวนแรกแล้ว 🚆'),

  -- ── the kitchen: Farmer's Delight is in this pack too ───────────────────
  ('advancement', 'farmersdelight:main/place_cooking_pot',    'ตั้งหม้อต้มใบแรกแล้ว 🍲'),
  ('advancement', 'farmersdelight:main/place_feast',          'จัดสำรับใหญ่เลี้ยงคนทั้งเซิร์ฟ 🍽️'),
  ('advancement', 'farmersdelight:main/master_chef',          'เป็น Master Chef แล้ว 👨‍🍳'),

  -- ── going further ───────────────────────────────────────────────────────
  ('advancement', 'minecraft:story/enter_the_nether',   'เข้าเนเธอร์ครั้งแรก 🔥'),
  ('advancement', 'minecraft:nether/netherite_armor',   'ได้เกราะเนเธอไรต์ครบชุด'),
  ('advancement', 'minecraft:story/enter_the_end',      'เปิดประตูสู่ดิ The End แล้ว'),

  -- ── the two fights people still talk about ──────────────────────────────
  ('advancement', 'minecraft:end/kill_dragon',          'ปราบ Ender Dragon สำเร็จ 🐉'),
  ('advancement', 'minecraft:nether/summon_wither',     'เรียก Wither ออกมาแล้ว — ขอให้โชคดี 💀'),
  ('advancement', 'minecraft:end/elytra',               'ได้ Elytra แล้ว บินได้เสียที 🪶'),
  ('kill', 'minecraft:ender_dragon', 'ฆ่า Ender Dragon ได้ 🐉'),
  ('kill', 'minecraft:wither',       'ฆ่า Wither ได้ 💀')
ON CONFLICT (kind, key) DO UPDATE SET label = EXCLUDED.label, enabled = TRUE;

COMMIT;
