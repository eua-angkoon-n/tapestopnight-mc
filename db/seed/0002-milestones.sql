-- The milestone allowlist: what is worth interrupting a Discord channel for.
--
-- SOURCE, not generated output. This is policy — somebody decided that taming
-- your first animal deserves a message and mining a thousand stone does not —
-- and policy belongs in review, the same argument that keeps the Edit Tiers in
-- TypeScript.
--
-- ── What changed with Prominence II: Hasturian Era (2026-11-20) ────────────
--
-- The Casket of Reveries was a souls-like boss pack on Forge. Prominence II
-- is a Fabric RPG with a story of its own (the `prominent` namespace: the
-- Void's Invasion, then the Hasturian Era), class and spell mods, and a tech
-- side — Create, AE2, Botania, Ad Astra — that the last pack did not have.
-- Cataclysm, Mowzie's Mobs, the Aether, Iron's Spellbooks and Book of Dragons
-- are not installed, so those rows can never match and they go. Bosses of
-- Mass Destruction is in both packs and its rows stay.
--
-- The pack's story ids are seeded only where the id says what happened
-- (`prominent:voids_invasion/killed_eye`, `prominent:level_50`). Ids such as
-- `prominent:foatf`, `prominent:azhar` or `prominent:molten_core` cannot be
-- labelled honestly from the id alone, so they are not seeded. Add one once
-- somebody who has played it can say what it marks.
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
-- `data/<namespace>/advancements/**.json` across all 373 mod jars and the
-- jars nested inside them, minus the recipe tree — 1,153 real advancements
-- across 57 namespaces, of which
-- only a handful are seeded. The rule applied was "would somebody say this out
-- loud in chat". To add more later:
--
--   docker exec tapestopnight-mc --     sh -c 'cat /data/prominence/advancements/*.json' | grep -o '"[a-z_]*:[a-z_/]*"' --     | sort -u | grep -v '^"minecraft:recipes'
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
-- these mods is in Prominence II, so no row under them can match. (ae2,
-- create and farmersdelight left this list: this pack has all three.)
DELETE FROM notable_milestone
 WHERE kind = 'advancement'
   AND (key LIKE 'cozystudioscore:%'
     OR key LIKE 'duckling:%'
     OR key LIKE 'exdeorum:%'
     OR key LIKE 'mekanism:%'
     OR key LIKE 'irons_spellbooks:%'
     OR key LIKE 'bookofdragons:%'
     OR key LIKE 'aether:%'
     OR key LIKE 'mowziesmobs:%'
     OR key LIKE 'cataclysm:%');

INSERT INTO notable_milestone (kind, key, label) VALUES
  -- ── the first hours ─────────────────────────────────────────────────────
  ('advancement', 'minecraft:story/mine_diamond',       'เจอเพชรแล้ว 💎'),
  ('advancement', 'minecraft:husbandry/tame_an_animal', 'มีเพื่อนสัตว์เลี้ยงตัวแรกแล้ว 🐾'),
  ('advancement', 'prominent:intro/reaching_overworld', 'ก้าวออกมาถึง Overworld แล้ว การผจญภัยเริ่มต้น 🌄'),
  ('advancement', 'prominent:level_10',                 'เลเวล 10 แล้ว ⭐'),
  ('advancement', 'prominent:level_50',                 'เลเวล 50 แล้ว 🌟'),

  -- ── other worlds ────────────────────────────────────────────────────────
  ('advancement', 'minecraft:story/enter_the_nether',   'เข้าเนเธอร์ครั้งแรก 🔥'),
  ('advancement', 'minecraft:story/enter_the_end',      'เปิดประตูสู่ The End แล้ว'),
  ('advancement', 'minecraft:end/elytra',               'ได้ Elytra แล้ว บินได้เสียที 🪶'),
  ('advancement', 'ad_astra:tier_1_rocket',             'สร้างจรวดลำแรกสำเร็จ 🚀'),
  ('advancement', 'ad_astra:moon',                      'ไปถึงดวงจันทร์แล้ว 🌕'),
  ('advancement', 'ad_astra:mars',                      'ไปถึงดาวอังคารแล้ว 🔴'),

  -- ── the craft side ──────────────────────────────────────────────────────
  ('advancement', 'ae2:main/controller',                'สร้าง ME Controller เริ่มระบบ AE2 แล้ว 💾'),
  ('advancement', 'botania:main/elf_portal_open',       'เปิดประตูสู่ Alfheim ของ Botania แล้ว 🌸'),

  -- ── the story: what this pack is actually about ────────────────────────
  ('advancement', 'prominent:voids_invasion/killed_eye', 'ปราบ The Eye ในศึก Void''s Invasion ได้แล้ว 👁️'),
  ('advancement', 'prominent:end_of_voids_invasion',    'จบศึก Void''s Invasion แล้ว 🏆'),
  ('advancement', 'prominent:bosses/fallen_archmage',   'ล้ม Fallen Archmage ได้แล้ว 🧙'),

  -- ── the bosses ──────────────────────────────────────────────────────────
  ('advancement', 'bosses_of_mass_destruction:adventure/night_lich_defeat', 'ปราบ Night Lich สำเร็จ 💀'),
  ('advancement', 'bosses_of_mass_destruction:nether/gauntlet_defeat',      'ปราบ Nether Gauntlet สำเร็จ 🔥'),
  ('advancement', 'bosses_of_mass_destruction:adventure/void_blossom_defeat', 'ปราบ Void Blossom สำเร็จ 🌸'),
  ('advancement', 'bosses_of_mass_destruction:end/obsidilith_defeat',      'ปราบ Obsidilith สำเร็จ 🗿'),
  ('advancement', 'adventurez:blackstone_golem_advancement', 'ล้ม Blackstone Golem ได้แล้ว 🪨'),
  ('advancement', 'adventurez:void_shadow_advancement', 'ล้ม Void Shadow ได้แล้ว 🌑'),
  ('advancement', 'archon:kill_ayla',                   'ล้ม Ayla ได้แล้ว ⚔️'),
  ('advancement', 'archon:kill_inigo',                  'ล้ม Inigo ได้แล้ว ⚔️'),
  ('advancement', 'archon:kill_leven',                  'ล้ม Leven ได้แล้ว ⚔️'),
  ('advancement', 'archon:kill_tar',                    'ล้ม Tar ได้แล้ว ⚔️'),
  ('advancement', 'archon:kill_null',                   'ล้ม Null ได้แล้ว ⚔️'),
  ('advancement', 'soulsweapons:draugr_boss',           'ล้มบอส Draugr ได้แล้ว 🪓'),
  ('advancement', 'soulsweapons:moonknight',            'ล้ม Moonknight ได้แล้ว 🌙'),
  ('advancement', 'soulsweapons:kill_day_night_boss',   'ล้มบอสคู่ Day Stalker และ Night Prowler ได้แล้ว ☀️🌙'),
  ('advancement', 'minecells:unlock/kill_concierge',    'ล้ม The Concierge ได้แล้ว 🔨'),
  ('advancement', 'minecells:unlock/kill_conjunctivius', 'ล้ม Conjunctivius ได้แล้ว 👁️'),
  ('advancement', 'botania:main/gaia_guardian_kill',    'ปราบ Gaia Guardian สำเร็จ 🌿'),
  ('advancement', 'graveyard:graveyard/summon_lich',    'อัญเชิญ Lich แห่งสุสานออกมาแล้ว — ขอให้โชคดี 💀'),

  -- ── the two vanilla fights people still talk about ──────────────────────
  ('advancement', 'minecraft:end/kill_dragon',          'ปราบ Ender Dragon สำเร็จ 🐉'),
  ('advancement', 'minecraft:nether/summon_wither',     'เรียก Wither ออกมาแล้ว — ขอให้โชคดี 💀'),
  ('kill', 'minecraft:ender_dragon', 'ฆ่า Ender Dragon ได้ 🐉'),
  ('kill', 'minecraft:wither',       'ฆ่า Wither ได้ 💀')
ON CONFLICT (kind, key) DO UPDATE SET label = EXCLUDED.label, enabled = TRUE;

COMMIT;
