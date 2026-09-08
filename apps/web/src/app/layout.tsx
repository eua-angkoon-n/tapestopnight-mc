import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Cinzel } from "next/font/google";

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
 * Display serif for LATIN-ONLY text. Cinzel has no Thai glyphs, which is
 * exactly why it is confined to the server name and numbers and never used for
 * body copy.
 */
const display = Cinzel({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-display-loaded",
});

export const metadata: Metadata = {
  title: "RLCraft Dregora — tapestopnight.com",
  description:
    "เซิร์ฟเวอร์ RLCraft Dregora v1.1.2b — Minecraft 1.12.2 Forge. ดูสถานะเซิร์ฟเวอร์ ไอพี และลิงก์ดาวน์โหลด modpack",
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
