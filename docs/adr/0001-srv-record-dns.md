# Minecraft reached via SRV, so the apex stays Cloudflare-proxied

A Minecraft client connecting to `tapestopnight.com` resolves
`_minecraft._tcp.tapestopnight.com` (SRV) *before* consulting the apex A record, and honours
the SRV target when present. Cloudflare's orange-cloud proxy carries only HTTP/HTTPS — raw TCP
needs Spectrum, an enterprise product — so game traffic must reach the origin DNS-only.
Rather than sacrifice the apex, we split them:

| Record | Type | Value | Cloudflare |
|---|---|---|---|
| `mc.tapestopnight.com` | A | `217.216.111.122` | **DNS-only (grey)** |
| `_minecraft._tcp.tapestopnight.com` | SRV | `0 5 25565 mc.tapestopnight.com` | n/a |
| `tapestopnight.com` | A | `217.216.111.122` | **Proxied (orange)** — the website |
| `ledger.tapestopnight.com` | A | unchanged | unchanged |

Players type bare `tapestopnight.com`, no port. The website keeps Cloudflare TLS/CDN/DDoS.

**Consequence:** `mc.` publicly exposes the origin IP — already true via `ledger.`, so nothing
new leaks, but port 25565 gets no Cloudflare shielding. The Host needs its own firewall.
