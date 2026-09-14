"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The narrow-screen disclosure for the site header.
 *
 * ── Why this is a client component when the header is not ─────────────────
 *
 * SiteHeader stays a server component: it calls auth() and renders sign-in and
 * sign-out as server actions, and that only works on the server. So the toggle
 * is the client boundary and the menu's CONTENTS arrive as `children` —
 * server-rendered, forms and all, handed across as a ReactNode. Nothing about
 * the header moves to the browser except the open/closed flag.
 *
 * ── Why not <details>, which would cost no JavaScript at all ──────────────
 *
 * It was the first choice, and ADR-0006's "a navigation bar without a client
 * bundle" argues for it. It loses on one point that matters more: a <details>
 * panel does not close when a link inside it is followed. Two of these links
 * are same-page anchors, so tapping one scrolls the page and leaves the menu
 * sitting over the content the person just asked to see. That is a bug the
 * saved kilobyte does not pay for.
 *
 * Above the breakpoint this renders nothing of its own — the button is display:
 * none and the panel is an ordinary flex row, exactly the bar that was there
 * before.
 */
export function NavMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes it. Expected of anything that covers the page, and the only
  // way out for somebody who opened it by keyboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /*
    Close when a link inside is followed.

    Delegated rather than wired to each link, because the children are built on
    the server and this component never sees them as elements — only as opaque
    nodes. `closest("a")` also catches a click on something inside a link.

    Deliberately NOT closing on the sign-in and sign-out buttons: those submit a
    form and navigate on their own, and hiding the menu first makes the click
    look like it did nothing while the request is in flight.
  */
  function onPanelClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="site-nav-panel"
        aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
        onClick={() => setOpen((v) => !v)}
      >
        {/*
          Drawn rather than a glyph. The bars animate into a cross, which says
          "this same control closes it" without needing a second icon — and a
          hamburger character has no Thai-safe fallback if the font is late.
        */}
        <span className="nav-toggle-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      <div
        id="site-nav-panel"
        ref={panelRef}
        className="nav-panel"
        data-open={open ? "true" : "false"}
        onClick={onPanelClick}
      >
        {children}
      </div>
    </>
  );
}
