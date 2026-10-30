-- The milestone allowlist: what is worth interrupting a Discord channel for.
--
-- SOURCE, not generated output. This is policy — somebody decided that taming
-- your first animal deserves a message and mining a thousand stone does not —
-- and policy belongs in review, the same argument that keeps the Edit Tiers in
-- TypeScript.
--
-- ── What changed with The Casket of Reveries (2026-10-30) ──────────────────
--
-- ATM10 To the Sky was a tech skyblock, and this list was built around it.
-- The Casket of Reveries is a souls-like RPG on Epic Fight: a story of
-- retrieving lost sparks, and a long line of bosses from L_Ender's
-- Cataclysm, Mowzie's Mobs, Bosses of Mass Destruction and the Aether. The
-- tech rows go — Ex Deorum, AE2, Mekanism, Create and Farmer's Delight are
-- not installed, so those rows can never match — and the boss kills are what
-- people will actually say out loud.
--
-- The pack's own story bosses (tcr_bosses, EpicFight Nightfall) publish no
-- advancements for their kills; only tcrcore's unlock_* progression ids exist,
-- and their meaning cannot be read from the id alone, so they are not seeded.
-- Add a 'kill' row for one once its entity id has been read from a real
-- statistics file on the Host.
--
-- The kinds:
--
--   kind='advancement'  the id in <world>/advancements/<uuid>.json, `done:true`
--   kind='kill'         the statistics file counted the kill
--
-- ── Where these ids came from ──────────────────────────────────────────────
--
-- Vanilla 1.20.1 ids come from the game itself and exist on any server. The
-- pack's own ids were read out of the server pack's jars, not guessed: every
-- `data/<namespace>/advancements/**.json` across all 159 mod jars, minus the
-- recipe tree — 367 real advancements across 22 namespaces, of which
-- only a handful are seeded. The rule applied was "would somebody say this out
-- loud in chat". To add more later:
--
--   docker exec tapestopnight-mc --     sh -c 'cat /data/reveries/advancements/*.json' | grep -o '"[a-z_]*:[a-z_/]*"' --     | sort -u | grep -v '^"minecraft:recipes'
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

-- Earlier packs' rows. Already announced milestones live in player_milestone
-- and are not touched. Deleting by namespace rather than by list: none of
-- these mods is in The Casket of Reveries, so no row under them can match.
DELETE FROM notable_milestone
 WHERE kind = 'advancement'
   AND (key LIKE 'cozystudioscore:%'
     OR key LIKE 'duckling:%'
     OR key LIKE 'exdeorum:%'
     OR key LIKE 'ae2:%'
     OR key LIKE 'mekanism:%'
     OR key LIKE 'create:%'
     OR key LIKE 'farmersdelight:%');

INSERT INTO notable_milestone (kind, key, label) VALUES
  -- ── the first hours ─────────────────────────────────────────────────────
  ('advancement', 'minecraft:story/mine_diamond',       'เจอเพชรแล้ว 💎'),
  ('advancement', 'minecraft:husbandry/tame_an_animal', 'มีเพื่อนสัตว์เลี้ยงตัวแรกแล้ว 🐾'),
  ('advancement', 'irons_spellbooks:irons_spellbooks/make_inscription_table', 'สร้างโต๊ะจารึกเวท เริ่มสายเวทมนตร์แล้ว 📜'),
  ('advancement', 'bookofdragons:dragon_tamer',         'ฝึกมังกรตัวแรกได้แล้ว 🐲'),

  -- ── other worlds ────────────────────────────────────────────────────────
  ('advancement', 'minecraft:story/enter_the_nether',   'เข้าเนเธอร์ครั้งแรก 🔥'),
  ('advancement', 'aether:enter_aether',                'ขึ้นไปถึงดินแดน Aether แล้ว ☁️'),
  ('advancement', 'minecraft:story/enter_the_end',      'เปิดประตูสู่ดิ The End แล้ว'),
  ('advancement', 'minecraft:end/elytra',               'ได้ Elytra แล้ว บินได้เสียที 🪶'),

  -- ── the bosses: what this pack is actually about ───────────────────────
  ('advancement', 'mowziesmobs:kill_ferrous_wroughtnaut', 'ล้ม Ferrous Wroughtnaut ได้แล้ว ⚔️'),
  ('advancement', 'mowziesmobs:kill_frostmaw',          'ล้ม Frostmaw ได้แล้ว ❄️'),
  ('advancement', 'mowziesmobs:kill_umvuthi',           'ล้ม Umvuthi ได้แล้ว ☀️'),
  ('advancement', 'aether:bronze_dungeon',              'พิชิตดันเจี้ยนทองสัมฤทธิ์ของ Aether'),
  ('advancement', 'aether:silver_dungeon',              'พิชิตดันเจี้ยนเงินของ Aether'),
  ('advancement', 'aether:gold_dungeon',                'พิชิตดันเจี้ยนทองของ Aether ☀️'),
  ('advancement', 'bosses_of_mass_destruction:adventure/night_lich_defeat', 'ปราบ Night Lich สำเร็จ 💀'),
  ('advancement', 'bosses_of_mass_destruction:nether/gauntlet_defeat',      'ปราบ Nether Gauntlet สำเร็จ 🔥'),
  ('advancement', 'bosses_of_mass_destruction:adventure/void_blossom_defeat', 'ปราบ Void Blossom สำเร็จ 🌸'),
  ('advancement', 'bosses_of_mass_destruction:end/obsidilith_defeat',      'ปราบ Obsidilith สำเร็จ 🗿'),
  ('advancement', 'cataclysm:kill_ender_guardian',      'ล้ม Ender Guardian ได้แล้ว'),
  ('advancement', 'cataclysm:kill_ignis',               'ล้ม Ignis ได้แล้ว 🔥'),
  ('advancement', 'cataclysm:kill_harbinger',           'ล้ม The Harbinger ได้แล้ว 🤖'),
  ('advancement', 'cataclysm:kill_leviathan',           'ล้ม The Leviathan ได้แล้ว 🌊'),
  ('advancement', 'cataclysm:kill_monstrosity',         'ล้ม Netherite Monstrosity ได้แล้ว'),
  ('advancement', 'cataclysm:kill_maledictus',          'ล้ม Maledictus ได้แล้ว 👻'),
  ('advancement', 'cataclysm:kill_scylla',              'ล้ม Scylla ได้แล้ว ⚡'),
  ('advancement', 'cataclysm:kill_all_bosses',          'ล้มบอส Cataclysm ครบทุกตัวแล้ว 👑'),

  -- ── the two vanilla fights people still talk about ──────────────────────
  ('advancement', 'minecraft:end/kill_dragon',          'ปราบ Ender Dragon สำเร็จ 🐉'),
  ('advancement', 'minecraft:nether/summon_wither',     'เรียก Wither ออกมาแล้ว — ขอให้โชคดี 💀'),
  ('kill', 'minecraft:ender_dragon', 'ฆ่า Ender Dragon ได้ 🐉'),
  ('kill', 'minecraft:wither',       'ฆ่า Wither ได้ 💀')
ON CONFLICT (kind, key) DO UPDATE SET label = EXCLUDED.label, enabled = TRUE;

COMMIT;
