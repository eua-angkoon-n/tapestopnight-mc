# Accounts are linked by IP address, with a code as the path that actually works for many people

The Chat Bridge lets people talk to the game from the website, and the website
knows a Discord identity while the game knows a Minecraft name. Something has to
join them, because posting is gated on being linked — an unlinked account can
read the conversation but not speak in it.

**Decision: match the address the browser arrives from against the address that
player logged into the game from, and fall back to a typed code when the address
cannot answer.** The address path was chosen deliberately, over the objection
below, because it is invisible when it works and most of this server's players
are on one home connection.

## HONEST LIMITATION: the address is wrong more often than it looks

Recorded here rather than discovered later, in the same spirit as the socket
proxy scope note in `deploy/docker-compose.yml`.

**IPv4/IPv6 mismatch, and it is not an edge case.** `mc.tapestopnight.com` is an
A record only (`217.216.111.122`), so the game always connects over IPv4. But
`tapestopnight.com` is Cloudflare-proxied and has AAAA records
(`2606:4700:…`), so a browser on any IPv6-capable connection — which on Thai
consumer ISPs is most of them — reaches the site over IPv6. Those two addresses
have nothing to do with each other and will never match. The same player, the
same house, the same minute: no match.

**A shared address cannot identify anyone.** Two players in one house, or behind
one CGNAT pool, produce two names for one address. Linking either would hand
somebody another player's identity, so the code refuses instead: more than one
candidate means no automatic link, ever. On a server with `max-players=8`, two
people in one house is a normal Tuesday, not a corner case.

**Therefore the code path is not a fallback in the decorative sense.** It is the
path a large fraction of players will actually use, and it is built to be as
smooth as the automatic one: the website hands out a six-character code, the
player types `!link ABC123` in game, and the bridge links them. The code is
consumed on use whether or not the link succeeded — by then it has been said out
loud in a public chat channel.

A code-only design was the alternative and would have been simpler. It was not
chosen: when the address does match, linking with no interaction at all is
better, and the code is there for when it does not.

## What makes the address believable

Naively reading `X-Forwarded-For` and taking the first entry would not be a
shortcut, it would be a hole: that value is whatever the client sent, so anyone
could claim any address and be handed the matching player's identity.

So two things had to be true, and neither was before this:

1. `deploy/caddy/Caddyfile` lists Cloudflare's published ranges as
   `trusted_proxies` and sets `client_ip_headers CF-Connecting-IP`. Caddy honours
   that header only for requests that genuinely arrived from Cloudflare. **Those
   ranges change** — re-fetch them from `cloudflare.com/ips-v4` and `/ips-v6`
   rather than copying the block forward.
2. The reverse proxy sets `X-Real-Client-IP` from `{client_ip}` with
   `header_up`, which **replaces** any value the client sent. The app reads that
   one header and nothing else, and treats its absence as "no match" rather than
   falling back to something weaker.

Addresses are recorded per `(player, address)` rather than one row per player,
specifically so the "two names, one address" case is visible rather than
averaged away. They expire as evidence after 14 days; a link once made is
permanent, so moving house or switching to mobile data later changes nothing.

## Consequences

- A player who cannot be matched by address is told so plainly and given the
  code in the same place they pressed the button — not sent somewhere else to
  find out why nothing happened.
- Both directions of `player_link` are unique: one Discord account, one
  character. Re-linking is a delete and an insert, never two live rows, so "who
  said this" always has exactly one answer.
- `!link` is parsed out of chat and deliberately **not** relayed to the website
  or Discord. It carries a live credential.
- The gap this leaves: an attacker who can get onto the same NAT as a player,
  and who signs in before that player ever links, can claim their name. Weighed
  against a whitelisted-in-practice friend server of eight, and against the fact
  that the damage is impersonation in a chat relay rather than access to
  anything. If the server ever opens up, this decision should be revisited and
  the code made the only path.
