---
status: accepted
supersedes: ADR-0007
---

# Design system: Cozy light tokens, Thai-first typography, structural tiers

ADR-0007 chose a Dark Fantasy palette because the server was RLCraft Dregora, and the reason it
gave was about the pack: *"RLCraft's world is soil, torchlight and rust, and a cold grey would
read as a dashboard."* That reasoning was sound and it is now pointing at the wrong pack.
Homestead is a cozy survival pack — wheat fields, timber, kitchen gardens, daylight — and a
near-black site in front of it reads as a different game.

The palette is therefore replaced. **Everything ADR-0007 decided that was not about the pack is
carried forward unchanged**, and restated here in full rather than left behind in a superseded
file, because a design system split across two documents is one nobody reads.

## The tokens

One token set serves both surfaces; only density changes. Public pages use serif display
headings and a faint texture; the admin panel drops both and tightens spacing.

```
bg      #FAF6EE     surface #FFFFFF     surface-raised #F1E9DB
border  #DED2BF     border-strong #C4B49A
text    #2E2A24     muted   #6B6155     faint #7D7060
accent  #C2683C (terracotta)   accent-hot #A8542E   accent-deep #8E4524
sage    #6E8B5E     danger  #A8412F
tier-guarded #B8801A   tier-locked #5B6470   ok #43794F
```

Warm cream rather than white, for the same reason ADR-0007 wanted warm blacks rather than
blue-blacks: a neutral grey ground reads as a dashboard whichever end of the scale it sits at.

**`--accent-hot` is darker than `--accent`, which is the reverse of the old set.** It is the
link colour, and a link has to clear 4.5:1 against the page. On black, the brighter ember was
the accessible one; on cream it is the darker terracotta that passes (4.86:1) while `--accent`
at 3.65:1 is confined to fills and glyphs, where 3:1 is the bar. Inverting that relationship
silently is the single most likely way for this palette to fail an audit, so it is written down.

`.btn-primary` fills with `--accent-hot`, not `--accent`: white on `#C2683C` is 3.93:1 and
near-black on it is 4.19:1, so **neither** label passes on the lighter fill. White on `#A8542E`
is 5.23:1.

`--tier-locked` keeps the cool slate it had under the dark theme. It was chosen to be
unmistakably not-warm so it could never be confused with the accent or the danger red, and that
reason has nothing to do with whether the ground is dark.

`html { color-scheme: light }`, and the hero scrim had to **change direction** — it was a black
wash under light text and is now a cream wash under dark text. A dark scrim beneath dark text is
not a weaker fix, it is the wrong one, and Homestead's sunlit footage would swallow the type.

## Thai-first typography — unchanged from ADR-0007

The UI is Thai, with technical terms left in English (config keys, mod names, IP, version
numbers — these are identifiers; translating `level-name` would stop an admin matching it
against the modpack docs). Consequences:

- Thai needs `line-height: 1.75`, not the ~1.5 an English-only design would use — Thai stacks
  vowels above the line and tone marks above those, and tight leading collides them
- **Thai has no capital letters**, so `text-transform: uppercase` and small-caps cannot carry
  heading hierarchy. Size and weight must do that work.
- Font stack needs a real Thai face — **IBM Plex Sans Thai**, loaded with the `thai` subset
  explicitly. Do not change this face.
- **Minecraft pixel fonts have no Thai glyphs.** Any pixel face is confined to English display
  text only, never body copy, or Thai silently falls back mid-line with misplaced tone marks.

The display face moves from **Cinzel** to **Fraunces**, and it is subject to the same rule: it
is Latin-only, so it is confined to `.display` and never touches body copy. Cinzel was a Roman
inscriptional face — effectively all-caps by construction, which suited dark fantasy and, per
the rule above, did nothing for Thai. Fraunces has a real lowercase and a soft axis that reads
as warm rather than carved.

## Edit Tiers are structural — unchanged from ADR-0007

Expressed structurally, with colour only as reinforcement. The original reason was that the
ember accent, the amber a GUARDED warning wants and the `danger` red all sit in one hue zone,
and roughly 8% of men with red–green colour vision deficiency cannot reliably separate them.
The palette moved; the hues are still terracotta, amber and red, and the eyes reading them have
not changed. A signal that stops someone destroying the world must not depend on hue:

- **FREE** — an ordinary input
- **GUARDED** — an input with a thick amber left border, plus a typed-confirmation gate
- **LOCKED** — **not rendered as an input at all.** Static text with a lock glyph and the
  reason. Not a `disabled` input: unfocusable, untabbable, and impossible to submit even
  through a bug.

## One place, and one duplicate that now is not

The tokens live in `apps/web/src/app/globals.css` and nowhere else. TSX reads them through
`var(--*)`; there are no literal colours left in the web components.

Discord cannot read CSS custom properties, so embed colours have to be integers — and six of
them were written as literals across three bot handlers. The web changed to cozy and the bot
went on answering in ember. They now live in `packages/core/src/brand.ts`, which both handlers
import, with the two values that deliberately differ (an embed renders on a dark Discord theme,
not on cream) documented there rather than discovered later.
