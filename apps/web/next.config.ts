import type { NextConfig } from "next";

const config: NextConfig = {
  // ADR-0012 budgets this app tightly: it shares a 12 GB Host with a 7 GB JVM.
  // The standalone output ships only the traced dependencies, which is a real
  // reduction in resident memory over running the full node_modules tree.
  output: "standalone",

  // packages/core is TypeScript source, consumed directly rather than built.
  transpilePackages: ["@tapestopnight/core"],

  // The public pages read the Status Poller's cache row, never the Game Server.
  // Nothing here should be statically cached at build time.
  experimental: { staleTimes: { dynamic: 0 } },

  poweredByHeader: false,
};

export default config;
