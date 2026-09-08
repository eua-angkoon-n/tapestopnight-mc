# One TypeScript monorepo: Next.js web + discord.js bot, shared core

> **User override.** Claude recommended Python (FastAPI + Jinja2 + HTMX) on the grounds that
> the chosen design needs almost no client-side state and the Host is RAM-constrained. The
> user chose TypeScript. This is the user's decision and is final; the reasoning below is the
> honest case *for* it, plus the costs to manage.

ADR-0004 requires the web app and bot to agree perfectly on who is an admin. Splitting them
across languages means writing that check twice, and the copies will drift. So both live in
one repo:

```
apps/web      Next.js — public info pages + admin config UI
apps/bot      discord.js — the slash-command tree
packages/core  auth · config · control  (shared by both apps)
```

- `auth` — Discord OAuth + guild-role check (the ADR-0004 authority)
- `config` — Postgres access, ADR-0003 tier rules, the ADR-0002 renderer
- `control` — RCON client, Server List Ping, and Docker start/stop/restart

**What TypeScript genuinely wins here:**

- **`minecraft-server-util`** covers Server List Ping, RCON *and* Query in one maintained
  library — exactly what the status design needs
- **Auth.js** with the Discord provider handles the OAuth dance with far less code than
  hand-rolling it, including the `guilds.members.read` scope
- **`dockerode`** talks to the socket-proxy directly

**Costs accepted:** two Node runtimes cost roughly **~350 MB** against ~150 MB for the Python
equivalent, on a Host that already shares RAM with the ledger app — this is folded into the
Phase 0 arithmetic. And the design deliberately stays server-rendered: **no SPA, no client
state library.** Interactivity is a clipboard copy, a polled status fragment, a confirm gate,
and an image upload. If React is used, it is Server Components with tiny client islands.
