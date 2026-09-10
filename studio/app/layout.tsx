import type { Metadata } from "next";
import "./globals.css";
import "./command-center.css";
import "./review-upgrade.css";

export const metadata: Metadata = {
  title: "Astra HQ — Your team, in motion",
  description:
    "A place for your AI workforce. Set a direction, see work come together, and keep your promises.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
