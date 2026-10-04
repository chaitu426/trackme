import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrackMe — Cookieless Privacy Analytics",
  description: "Lightweight, cookieless, GDPR-compliant web analytics powered by ClickHouse. No consent banners needed.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
