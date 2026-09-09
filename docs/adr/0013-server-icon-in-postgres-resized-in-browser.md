# Server Icon bytes live in Postgres, and the resize happens in the browser

Minecraft requires `server-icon.png` to be **exactly 64×64** and **silently ignores any other
size** — no error, no log line, nothing in the server list. That is the failure this decision
is shaped around: an admin uploads a 128px image, is told it worked, and is wrong until
somebody happens to look.

So the admin uploads **one** high-resolution square image and the system derives the 64×64 PNG
itself. Two questions followed: where the bytes live, and who does the resizing.

## Where the bytes live: Postgres, as two columns

ADR-0002 already answers this if the icon is read as config rather than as a file:

| | |
|---|---|
| `server_info.icon_source` — the admin's upload, rendered on the public hero | **Desired Config** |
| `/pack/server-icon.png` — written by Apply | **Rendered Config**, owned by nobody |

`icon_64` holds the validated derivative between upload and Apply, so Apply stays a pure
materialisation step with nothing left to compute.

**Why not the pack directory.** `/srv/mc/pack` is vendor payload. `check-drift.sh` compares it
against (verified zip + overlay), so an uploaded file dropped in there is reported as drift
forever — the overlay discipline in ADR-0009 turned against us.

**Why not a new volume.** It would need its own backup story. Postgres already has one, and
these images are hundreds of KB.

**Consequence:** the bytes reach a browser only through `/api/icon`, and every query that
touches `server_info` must name its columns — a bare `select()` would drag both blobs into
every public page render. Both call sites do; a third that forgets will not fail, it will just
be slow, which is the unpleasant kind of regression.

## Who resizes: the browser, but the server does not trust it

The obvious answer is `sharp` on the server. We declined it: ~30 MB of native library and its
working memory inside a web container capped at `mem_limit: 384m`, on a Host where ADR-0012
leaves roughly 1.5 GB of total headroom beside a 7 GB JVM. Next.js `output: "standalone"`
would have to trace it too, and `next/image` is avoided across this app for the same reason.

So the client draws the image into a `<canvas>`, stepping down by halves, and posts **two**
files: the original and the PNG it produced. This is one of the four interactions ADR-0006
already expects on the client.

**The server validates the bytes it received, not the promise it was made.**
`packages/core/src/config/icon.ts` reads the PNG signature and IHDR itself and refuses
anything that is not 64×64; it sniffs the source format from magic bytes and never consults
the declared `Content-Type`. A crafted POST bypassing the browser entirely is refused there.
`npm run icon:check` exercises the parsers, including the two details this kind of code always
gets wrong: JPEG stores height before width, and WebP's extended forms store dimensions minus
one.

**The contract is "`icon_64` is a PNG measuring 64×64" — not "the server did the resizing".**
Swapping in a server-side encoder later touches neither the schema nor Apply.

**Non-square uploads are rejected, not cropped.** Silent cropping would replace the trap this
whole feature removes with a different one: a success message and an image that is not the
image the admin chose. One pixel of tolerance is allowed, because real editors export
1001×1000.

**A failed icon write does not fail Apply.** By that point `server.properties` is already on
disk and the restart is what makes it real. Aborting to spare a decoration would leave the
config half applied, so the icon error is reported and Apply continues.
