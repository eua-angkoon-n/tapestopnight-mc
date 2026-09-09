# How the bot expresses authorisation: admin tiers, a fail-closed channel allowlist, and GUARDED without a text box

ADR-0004 settles *who* is an admin. Building the bot forced three questions it
does not answer, all of the form "what does that rule look like on a chat
surface". They are recorded together because they are one decision — the shape
of the bot's front door — and because each of them looks wrong to a reader who
does not know what it is defending against.

## Lifecycle commands are admin, not just `/config`

The plan named only `/config` as admin-only. **`/server start`, `stop` and
`restart` are admin here too.**

Each of them disconnects everyone currently playing, in a hardcore modpack
where a disconnect mid-fight can cost a character. "Anyone in the allowed
channel can stop the server mid-session" is not a property worth shipping to
save a line of configuration. The public half of the tree — `/server status`,
`/players list`, all of `/info` — exposes only what a Server List Ping already
tells the whole internet, plus what the public website shows.

`npm run bot:check` fails if any subcommand has no decided tier, so adding one
without making this choice is a build error rather than a silent default to
public. It also greps the tree for host-control verbs: there is deliberately no
command that can stop, reboot or shut down the **Host**, only the container.
The prior art this replaces had a `pc_shutdown`; the equivalent here would take
the unrelated `ledger` system down with it.

## Discord's own permission UI is a hint, not the boundary

Discord cannot express "only holders of `DISCORD_ADMIN_ROLE_ID`". Command
permissions are per-permission-flag or per-role, set in a UI that is not this
repo, and `default_member_permissions` is advisory — a guild administrator can
override it, and it says nothing about the role ADR-0004 actually names.

So `/config` carries `ManageGuild` as a **visibility hint** to keep it out of
ordinary members' autocomplete, and **every invocation is re-checked against
`authorizeAdmin` before it does anything**. Same reasoning the web app already
follows: the config link is hidden from non-admins for tidiness, and `/config`
answers a real 403 whether or not the link was drawn. Hiding a control is never
what stops someone using it.

## The channel allowlist fails closed, and says how to open it

Requirement 3.3 restricts the bot to set channels. With an empty
`allowed_channel` table the bot answers **nowhere**, because "nobody has said
where this may operate" reads as nowhere, not everywhere — the same fail-closed
default ADR-0003 gives unknown config keys.

The cost of fail-closed is a door with no visible handle: there is deliberately
no UI for this table, so a fresh deployment would look broken. The refusal
therefore carries the exact `INSERT` statement, with the current channel id
already substituted in. A fail-closed door that does not say how to open it is
how you get someone editing the database by guesswork.

## GUARDED is `confirm: True`, because a chat surface has no text box

ADR-0003's GUARDED tier means "changeable, but not by accident". The web
expresses it by making the admin type the server address — a gate that cannot
be passed by muscle memory.

Discord has no equivalent input. The options were a confirmation **button**, or
an explicit boolean on the command. We chose the boolean:

- a button is one click, arriving right where the cursor already is — weaker
  than the typed phrase, not equal to it
- `confirm: True` is part of the invocation, visible in the command history of
  the channel, and cannot be produced by pressing enter through autocomplete
- it holds no interaction state, so it cannot expire, leak a collector, or be
  clicked by somebody other than the person who typed the command

**LOCKED is refused outright**, with no flag that overrides it. Changing
`level-name` orphans the world and loses every player's progress along with the
pre-generation. There is no confirmation syntax that makes that a reasonable
thing to do from a chat message; the reason is shown instead, because ADR-0003
keeps locked keys visible so nobody goes hunting for the file over SSH.
