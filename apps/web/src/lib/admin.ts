import { auth } from "@/auth";

/**
 * The security boundary — ADR-0004.
 *
 * Page render decides what to SHOW. This decides what may be DONE, and it is
 * the only one of the two that is a boundary. Every mutating admin action calls
 * it, so hiding a control in the UI is never the thing standing between a
 * non-admin and a config change.
 *
 * Throws rather than returning a flag: a caller that forgets to check a boolean
 * fails open, and this must fail closed.
 */
export async function requireAdmin(): Promise<{ discordId: string }> {
  const session = await auth();
  if (!session?.isAdmin) {
    throw new AdminRequiredError();
  }
  return { discordId: session.discordId };
}

export class AdminRequiredError extends Error {
  constructor() {
    super("admin required");
    this.name = "AdminRequiredError";
  }
}

/** For rendering decisions only. Never gate a mutation on this. */
export async function viewerIsAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.isAdmin ?? false;
}
