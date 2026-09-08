# Reuse the DISCO NIGHT Discord application; retire DISCO NIGHT and Prominence control

> **User override.** Claude recommended creating a fresh Discord application. The user chose
> to reuse the existing credentials and retire DISCO NIGHT. Final.

Discord permits **one active gateway session per bot token**. Two processes on one token knock
each other offline in a loop, and because ADR-0004 reads guild roles through that bot, an
unstable gateway would break web login too. So reusing the token *requires* DISCO NIGHT to
stop — they cannot coexist.

The user accepted that, which has a further consequence they also confirmed: **Prominence
loses its control bot and is not adopted by the new system.** That was the right call —
Prominence runs from `start.bat` on the user's home Windows machine, and a bot in Docker on a
VPS in Europe cannot start a process there. Adopting it would have required either moving
Prominence onto the Host (pushing the RAM requirement from ~8.6 GB to ~13.4 GB and forcing a
Contabo upgrade) or shipping an agent onto the home PC behind NAT.

**Therefore the system stays deliberately single-server.** No `server_id` dimension in the
schema, no server selector in the UI, no server argument in the command tree. Generalising
later is a known, bounded change.

**Migration steps this forces:** stop DISCO NIGHT before the new bot first connects; delete
its registered slash commands so stale ones don't linger in the guild; rotate the token after
cutover (Phase 7) since it has been handled loosely.
