# Design system: Dark Fantasy tokens, Thai-first typography, structural tiers

One token set serves both surfaces; only density changes. Public pages use serif display
headings and a subtle noise texture; the admin panel drops both and tightens spacing.

```
bg      #0E0C0B     surface #1A1614     border #2E2724
text    #E8E0D5     muted   #9A8F84
accent  #C75B2A (ember)     danger  #A32E23
```

**Thai-first typography.** The UI is Thai, with technical terms left in English (config keys,
mod names, IP, version numbers — these are identifiers; translating `level-name` would stop an
admin from matching it against the modpack docs). Consequences:

- Thai needs `line-height: 1.75`, not the ~1.5 an English-only design would use — Thai stacks
  vowels above and tone marks above those, and tight leading collides them with the line above
- **Thai has no capital letters**, so `text-transform: uppercase` and small-caps — staples of
  dark-fantasy styling — cannot carry heading hierarchy. Size and weight must do that work.
- Font stack needs a real Thai face (IBM Plex Sans Thai / Noto Sans Thai)
- **Minecraft pixel fonts have no Thai glyphs.** Any pixel face is confined to English
  display text only, never body copy, or Thai silently falls back mid-line with misplaced
  tone marks.

**Edit Tiers are expressed structurally, with colour only as reinforcement** — because the
ember accent, the amber a GUARDED warning wants, and the red of `danger` all sit in one hue
zone, and roughly 8% of men with red–green colour vision deficiency cannot reliably separate
them. A signal that stops someone destroying the world must not depend on hue:

- **FREE** — an ordinary input
- **GUARDED** — an input with a thick amber left border, plus a typed-confirmation gate
- **LOCKED** — **not rendered as an input at all.** Static text with a lock glyph and the
  reason. Not a `disabled` input: unfocusable, untabbable, and impossible to submit even
  through a bug.
