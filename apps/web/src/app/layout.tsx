import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Fraunces } from "next/font/google";

import { SiteHeader } from "@/components/SiteHeader";

import "./globals.css";

/*
 * Thai is the primary language (ADR-0007), so the body face must have real
 * Thai coverage. IBM Plex Sans Thai is loaded with the thai subset explicitly:
 * without it the browser silently falls back mid-line and tone marks land in
 * the wrong place.
 */
const body = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-body-loaded",
});

/*
 * Display serif for LATIN-ONLY text. Fraunces has no Thai glyphs, which is
 * exactly why it is confined to the server name and numbers and never used for
 * body copy — the same rule that governed Cinzel before it.
 *
 * Cinzel was a Roman inscriptional face: all-caps by construction, which suited
 * dark fantasy and did nothing for Thai (ADR-0007 — Thai has no capitals, so
 * hierarchy comes from size and weight). Fraunces has a real lowercase and a
 * soft, slightly wonky axis that reads as warm rather than carved.
 */
const display = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-display-loaded",
});

export const metadata: Metadata = {
  title: "Homestead — tapestopnight.com",
  description:
    "เซิร์ฟเวอร์ Homestead — Minecraft 1.20.1 Fabric. ดูสถานะเซิร์ฟเวอร์ ไอพี และลิงก์ดาวน์โหลด modpack",

  /*
   * The browser tab icon is the Server Icon — the same upload players see in
   * their multiplayer list, read from the same Postgres row. One image, set
   * once, used in three places.
   *
   * Pointed at the route rather than a file in public/: the icon is
   * admin-editable, and a static favicon.ico would be a second copy that kept
   * quietly showing the old image after every upload.
   *
   * `v=64` is the exact 64x64 derivative, which is already the size a favicon
   * wants. The high-resolution original serves the Apple touch icon, where a
   * 64px image looks soft on a home screen.
   *
   * With no icon uploaded the route answers 404 and browsers fall back to
   * their own default, which is the right way for this to be absent.
   */
  icons: {
    icon: [{ url: "/api/icon?v=64", type: "image/png", sizes: "64x64" }],
    apple: [{ url: "/api/icon" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className={`${body.variable} ${display.variable}`}>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
