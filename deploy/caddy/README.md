# Caddy

`Caddyfile` here is a **copy** of what is live at `/etc/caddy/Caddyfile` on the
Host. Caddy is not in our compose project — it was already on the Host serving
`ledger.tapestopnight.com` before this project existed, and taking it over
would mean taking responsibility for someone else's uptime.

Tracked anyway because it is four lines that a rebuild would otherwise have to
rediscover, and because it is where ADR-0001's split is actually implemented.

Like the pack config overlay, this can drift from the live file. `deploy/check-drift.sh`
covers the pack; this one is small enough to eyeball.

## The certificate question, settled

`docs/host-inventory.md` flagged a risk: the apex is Cloudflare-**proxied**, so
Caddy's automatic HTTP-01 challenge has to traverse the orange cloud, and the
fallback would have been a Cloudflare Origin CA certificate or a DNS-01
challenge.

It was not needed. Cloudflare passes `/.well-known/acme-challenge` through to
the origin, and the issuance succeeded on the first attempt — the logs show
`served key authentication` to several Cloudflare edge IPs followed by
`certificate obtained successfully` from Let's Encrypt.

One thing worth knowing: issuance takes a few seconds, and a request made
during that window returns Cloudflare's **525 SSL Handshake Failed**. That is
the origin not having a certificate *yet*, not a misconfiguration. Wait and
retry before changing anything.
