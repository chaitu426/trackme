import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ChunkErrorReload } from "@/components/chunk-error-reload";
import { MotionProvider } from "@/components/motion/provider";
import { Toaster } from "@/components/ui/toaster";
import { BRAND, appOrigin } from "@/lib/brand";

// Self-hosted at build time: no render-blocking request to Google Fonts, no layout shift
// (the fallback is size-adjusted), and the files cache with the app's own assets.
const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-geist-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin()),
  applicationName: BRAND.name,
  // "Overview · TrackMe" on a page that sets a title; the line on the landing page.
  title: { default: `${BRAND.name}: ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  openGraph: { type: "website", siteName: BRAND.name, title: `${BRAND.name}: ${BRAND.tagline}`, description: BRAND.description },
  twitter: { card: "summary_large_image", title: `${BRAND.name}: ${BRAND.tagline}`, description: BRAND.description },
};

export const viewport: Viewport = {
  themeColor: BRAND.page,
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen antialiased bg-background text-foreground font-sans">
        <MotionProvider>
          {children}
          <Toaster />
        </MotionProvider>
        <ChunkErrorReload />
      </body>
    </html>
  );
}
