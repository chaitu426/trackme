import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

// Next only loads .env files from this app's directory, but the repo keeps one .env at
// the root. Without it the middleware (which reads process.env directly, not
// @trackme/config) has no NEXTAUTH_SECRET, rejects every session cookie and bounces
// each page back to /login. Existing environment variables are never overridden.
try {
  process.loadEnvFile?.(path.join(configDirectory, "../../.env"));
} catch {
  // No root .env (CI, container): real environment variables apply.
}
const analyticsSource = path.join(configDirectory, "../../packages/analytics/src/index.ts");

const nextConfig: NextConfig = {
  // A preview can use its own build folder (NEXT_DIST_DIR=.next-preview) so it never overwrites a running production build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "flagcdn.com" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
    ],
  },
  transpilePackages: [
    "@trackme/contracts",
    "@trackme/config",
    "@trackme/authz",
    "@trackme/db",
    "@trackme/analytics",
    "@trackme/landing",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // Next 15 defaults the client router cache to 0s for dynamic pages, so every click
    // re-fetched a page the user had just seen. Keep visited dashboard pages for 30s
    // (back/forward and tab hopping are instant; data is at most 30s old, which matches
    // the live-range cache TTL) and prefetched shells for 3 minutes.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // Import only the icons used instead of the whole lucide barrel.
    optimizePackageImports: ["lucide-react", "react-simple-maps"],
  },
  async headers() {
    // The tracker is loaded on every page view of every customer site. Next serves
    // public files with max-age=0, which forces a revalidation round trip each time.
    // Cache for 5 minutes and serve stale for a day while refreshing in the background,
    // so a release reaches visitors within minutes and nobody waits for it.
    const trackerCache = [
      { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" },
      { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
    ];
    return [
      { source: "/tracker.js", headers: trackerCache },
      { source: "/t/v1/tracker.js", headers: trackerCache },
    ];
  },
  webpack(config) {
    // In workspace development, resolve analytics from source instead of its
    // previously-built dist entry. This keeps server-side query changes in
    // sync with Next's module graph and avoids stale analytics SQL at runtime.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@trackme/analytics": analyticsSource,
    };
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
