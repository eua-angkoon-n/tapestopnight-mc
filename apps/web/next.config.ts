import type { NextConfig } from "next";

const config: NextConfig = {
  // ADR-0012 budgets this app tightly: it shares a 12 GB Host with a 7 GB JVM.
  // The standalone output ships only the traced dependencies, which is a real
  // reduction in resident memory over running the full node_modules tree.
  output: "standalone",

  // packages/core is TypeScript source, consumed directly rather than built.
  transpilePackages: ["@tapestopnight/core"],

  experimental: {
    // The public pages read the Status Poller's cache row, never the Game
    // Server. Nothing here should be statically cached at build time.
    staleTimes: { dynamic: 0 },

    serverActions: {
      /*
        MUST stay above MAX_SOURCE_BYTES (2 MB, in packages/core/src/config/
        icon.ts) plus the 64x64 derivative and multipart overhead.

        The default is 1 MB, which silently contradicted a 2 MB upload limit:
        the icon upload posts both files in one Server Action, so anything over
        ~1 MB was rejected by the framework with a 413 BEFORE any of our
        validation ran — meaning the admin got no message at all, just an
        upload that did nothing. Lowering this again re-breaks uploads without
        breaking any test.
      */
      bodySizeLimit: "3mb",
    },

    // Enables forbidden() so the admin route can answer a real HTTP 403.
    // The plan's verification for Phase 5 is explicit that a non-admin hitting
    // /config must be refused SERVER-SIDE and tested by URL rather than by UI,
    // and a 404 or a redirect would not be the same claim.
    authInterrupts: true,
  },

  poweredByHeader: false,
};

export default config;
