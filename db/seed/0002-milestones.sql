-- The milestone allowlist: what is worth interrupting a Discord channel for.
--
-- SOURCE, not generated output. This is policy — somebody decided that taming
-- your first animal deserves a message and mining a thousand stone does not —
-- and policy belongs in review, the same argument that keeps the Edit Tiers in
-- TypeScript.
--
-- ── What changed from Dregora ───────────────────────────────────────────────
--
-- Everything. The previous version of this file was 24 rows of Better
-- Questing quest ids and Lycanites, Ice and Fire and SR Parasites entity ids.
-- None of those mods exist in Homestead, and Better Questing's
-- QuestProgress.json does not exist either — so every row in it matched
-- nothing and always would.
--
-- The kinds are now:
--
--   kind='advancement'  the id in <world>/advancements/<uuid>.json, `done:true`
--   kind='kill'         the statistics file counted the kill
--
-- Advancements are available here because Homestead does not switch them off.
-- Dregora did: config/fermiummixins.cfg shipped "Nuke Advancements
-- (Vanilla)"=true, which is why the old file explained at length why it could
-- not use them. → docs/adr/0015-chat-bridge-via-log-tail.md
--
-- ── Where these ids came from ──────────────────────────────────────────────
--
-- These are VANILLA 1.20.1 advancement ids, which are stable and exist on any
-- 1.20.1 server whether or not a pack adds to them. They are chosen for a
-- cozy survival server: the farming, taming and building line matters more
-- here than the boss-kill line did on Dregora.
--
-- The pack's own ids were read out of the server pack's jars, not guessed:
-- every `data/<namespace>/advancements/**.json` across all 307 mod jars, minus
-- the recipe tree. That is 10,837 recipe unlocks (which the reader skips) and
-- roughly 700 real advancements across 44 namespaces.
--
-- Only a handful are seeded. The rule applied was "would somebody say this out
-- loud in chat" — which rules out, for instance, all 32 of Comforts' one-per-
-- dye-colour hammock and sleeping-bag advancements. To add more later:
--
--   docker exec tapestopnight-mc \
--     sh -c 'cat /data/Homestead/advancements/*.json' | grep -o '"[a-z_]*:[a-z_/]*"' \
--     | sort -u | grep -v '^"minecraft:recipes'
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

INSERT INTO notable_milestone (kind, key, label) VALUES
  -- ── settling in: the first hours everyone shares ────────────────────────
  ('advancement', 'minecraft:story/mine_stone',        'ขุดหินก้อนแรกได้แล้ว ⛏️'),
  ('advancement', 'minecraft:story/smelt_iron',        'ถลุงเหล็กได้ครั้งแรก'),
  ('advancement', 'minecraft:story/obtain_armor',      'ใส่เกราะชุดแรกแล้ว 🛡️'),
  ('advancement', 'minecraft:story/mine_diamond',      'เจอเพชรแล้ว 💎'),
  ('advancement', 'minecraft:story/enchant_item',      'ร่ายมนตร์ของชิ้นแรกได้ ✨'),

  -- ── the homestead itself: what this pack is actually about ──────────────
  ('advancement', 'minecraft:husbandry/plant_seed',        'เริ่มลงเมล็ดพืชแปลงแรกแล้ว 🌱'),
  ('advancement', 'minecraft:husbandry/tame_an_animal',    'มีเพื่อนสัตว์เลี้ยงตัวแรกแล้ว 🐾'),
  ('advancement', 'minecraft:husbandry/breed_an_animal',   'เพาะพันธุ์สัตว์สำเร็จครั้งแรก'),
  ('advancement', 'minecraft:husbandry/breed_all_animals', 'เพาะพันธุ์สัตว์ครบทุกชนิดแล้ว 🐄🐖🐔'),
  ('advancement', 'minecraft:husbandry/balanced_diet',     'กินครบทุกอย่างที่กินได้ในเกม 🍎'),
  ('advancement', 'minecraft:husbandry/silk_touch_nest',   'ย้ายรังผึ้งทั้งรังมาไว้ที่บ้าน 🐝'),
  ('advancement', 'minecraft:husbandry/netherite_hoe',     'อัปจอบเป็นเนเธอไรต์ — เอาจริงเรื่องทำไร่ 🌾'),
  ('advancement', 'minecraft:adventure/trade',             'ค้าขายกับ villager ครั้งแรก 💰'),

  -- ── going further afield ────────────────────────────────────────────────
  ('advancement', 'minecraft:story/enter_the_nether',   'เข้าเนเธอร์ครั้งแรก 🔥'),
  ('advancement', 'minecraft:nether/find_fortress',     'เจอป้อมเนเธอร์แล้ว'),
  ('advancement', 'minecraft:nether/obtain_blaze_rod',  'ได้แท่ง Blaze มาแล้ว'),
  ('advancement', 'minecraft:nether/netherite_armor',   'ได้เกราะเนเธอไรต์ครบชุด'),
  ('advancement', 'minecraft:adventure/adventuring_time', 'เดินทางครบทุกไบโอม 🗺️'),
  ('advancement', 'minecraft:adventure/totem_of_undying', 'ได้ Totem of Undying มาครอง'),
  ('advancement', 'minecraft:story/enter_the_end',      'เปิดประตูสู่ดิ The End แล้ว'),

  -- ── the two fights people still talk about ──────────────────────────────
  ('advancement', 'minecraft:end/kill_dragon',          'ปราบ Ender Dragon สำเร็จ 🐉'),
  ('advancement', 'minecraft:nether/summon_wither',     'เรียก Wither ออกมาแล้ว — ขอให้โชคดี 💀'),
  ('advancement', 'minecraft:end/elytra',               'ได้ Elytra แล้ว บินได้เสียที 🪶'),
  ('kill', 'minecraft:ender_dragon', 'ฆ่า Ender Dragon ได้ 🐉'),
  ('kill', 'minecraft:wither',       'ฆ่า Wither ได้ 💀'),

  -- ── Homestead's own, from the cozystudioscore namespace ─────────────────
  -- `cozystudioscore/root` is deliberately absent: a root advancement is
  -- granted on arrival, so announcing it would congratulate people for joining.
  ('advancement', 'cozystudioscore:cozystudioscore/kiln',             'สร้างเตาเผา (Kiln) ของตัวเองแล้ว 🏺'),
  ('advancement', 'cozystudioscore:building_blocks/arborist_table',   'ตั้งโต๊ะ Arborist ได้แล้ว 🪵'),
  ('advancement', 'cozystudioscore:cozystudioscore/tranquil_lantern', 'ได้ Tranquil Lantern มาแล้ว 🏮'),
  ('advancement', 'cozystudioscore:misc/tree_whisperer',              'ปลดล็อก Tree Whisperer แล้ว 🌳'),

  -- ── Farmer's Delight: the kitchen, which is most of what this pack is ───
  ('advancement', 'farmersdelight:main/place_cooking_pot',    'ตั้งหม้อต้มใบแรกแล้ว 🍲'),
  ('advancement', 'farmersdelight:main/place_feast',          'จัดสำรับใหญ่เลี้ยงคนทั้งเซิร์ฟ 🍽️'),
  ('advancement', 'farmersdelight:main/get_rich_soil',        'ทำดินดี (Rich Soil) ได้แล้ว 🌾'),
  ('advancement', 'farmersdelight:main/master_chef',          'เป็น Master Chef แล้ว 👨‍🍳'),
  ('advancement', 'farmersdelight:main/obtain_netherite_knife', 'ได้มีดเนเธอไรต์มาแล้ว 🔪'),

  -- ── the one everybody will actually post a screenshot of ────────────────
  ('advancement', 'duckling:pet_duck',   'ได้เป็ดเป็นเพื่อนแล้ว 🦆'),
  ('advancement', 'duckling:breed_duck', 'เพาะพันธุ์เป็ดสำเร็จ 🐣')
ON CONFLICT (kind, key) DO UPDATE SET label = EXCLUDED.label, enabled = TRUE;

COMMIT;
