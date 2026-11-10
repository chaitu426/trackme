import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ChunkErrorReload } from "@/components/chunk-error-reload";
import { MotionProvider } from "@/components/motion/provider";
import { Toaster } from "@/components/ui/toaster";

// Self-hosted at build time: no render-blocking request to Google Fonts, no layout shift
// (the fallback is size-adjusted), and the files cache with the app's own assets.
const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "TrackMe — Cookieless Privacy Analytics",
  description: "Privacy-first web analytics: live traffic, funnels, journeys and Web Vitals without tracking cookies.",
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
