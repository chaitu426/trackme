import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TokenSync } from "@/components/token-sync";

export const metadata: Metadata = {
  title: {
    default: "TrackMe Docs",
    template: "%s · TrackMe Docs",
  },
  description:
    "Install the TrackMe tracker, track events, and call the API. Guides for every framework, language and platform.",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
        <TokenSync />
      </body>
    </html>
  );
}
