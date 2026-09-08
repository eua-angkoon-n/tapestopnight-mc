# Discord guild roles are the single authority for "who is an admin"

Requirements 2.1 (web admin login), 2.2 (public read-only) and 3.1 (bot admin commands) are
one authorisation question asked in two places. Answering them separately guarantees a "the
web says I'm an admin but the bot disagrees" class of bug.

**Authority: a role in the Discord guild.** The web app requests the `identify` +
`guilds.members.read` OAuth scopes and reads the caller's guild roles; the bot reads the same
roles from the member object it already has. One grant path — assign the Discord role —
governs both surfaces.

**Break-glass:** a small `admin_allowlist` table of `discord_id` in Postgres is also
consulted, so a Discord outage or role misconfiguration cannot lock everyone out of their own
control plane. Normal administration never touches it.

**Public access:** unauthenticated visitors get the read-only info pages. Config routes are
gated **server-side** on the role check — never merely hidden in the UI.
