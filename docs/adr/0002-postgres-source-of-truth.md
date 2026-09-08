# Postgres is the source of truth; `server.properties` is a build artifact

Minecraft reads `server.properties` and `server-icon.png` from disk at process start and
cannot talk to Postgres, so a materialisation step is unavoidable. The only real question was
which side wins on conflict. **Postgres is authoritative; the on-disk files are generated
output owned by nobody.**

Flow: admin edits in the web UI → row written to Postgres with author and timestamp →
explicit **Apply** renders the files and restarts the Game Server.

**Hard rule:** never hand-edit `server.properties` on the Host. Manual edits survive only
until the next Apply. The generated file carries a loud "GENERATED — DO NOT EDIT" header.

**Consequences:** config gains history, an audit trail, and rollback — the thing a
file-on-disk approach cannot do. Apply is restart-bearing, so it is gated and announced to
players.
