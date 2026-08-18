import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import { ORG_DBA_NAME } from "@/lib/org";
import "./globals.css";

export const metadata: Metadata = {
  title: ORG_DBA_NAME,
  description: `${ORG_DBA_NAME} — session booking and membership platform.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
