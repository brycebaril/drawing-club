import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life Drawing Society",
  description: "Scheduling and membership platform for the life drawing society.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
