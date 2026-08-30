import type { Metadata } from "next";
import { Caprasimo, Figtree } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { ORG_DBA_NAME } from "@/lib/org";
import "./globals.css";

// "Organic" design system (Design Philosophy.dc.html §02): Caprasimo for
// headings, Figtree for body. Loaded via next/font/google rather than the
// design system's own generic `@import url(fonts.googleapis.com/...)` —
// self-hosted at build time, no extra render-blocking request, no CLS.
// Caprasimo only ships weight 400 (see --font-heading-weight in globals.css).
const caprasimo = Caprasimo({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const figtree = Figtree({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: ORG_DBA_NAME,
  description: `${ORG_DBA_NAME} — session booking and membership platform.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
