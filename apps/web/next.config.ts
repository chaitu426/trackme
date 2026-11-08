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
    // Subresource Integrity on a script from another origin only works if that response allows CORS, otherwise
    // the browser refuses to run it. The files are public, so "*" exposes nothing.
    const trackerPublic = [
      { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      { key: "Access-Control-Allow-Origin", value: "*" },
    ];
    const trackerCache = [
      { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" },
      ...trackerPublic,
    ];
    // The versioned file never changes, so it can be cached for a year.
    const trackerImmutable = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ...trackerPublic,
    ];
    // Security headers for every page and API response. Everything here is safe to enforce unconditionally; the
    // script policy (which can block a page if it is wrong) is added per request by the middleware, in
    // report-only mode until CSP_MODE=enforce (see src/lib/csp.ts).
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
      ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
        : []),
    ];
    return [
      { source: "/tracker.js", headers: trackerCache },
      { source: "/t/v1/tracker.js", headers: trackerCache },
      { source: "/t/:version/tracker.:rest.js", headers: trackerImmutable },
      { source: "/t/manifest.json", headers: trackerCache },
      // The tracker is loaded by other sites; every other response gets the security headers.
      { source: "/((?!tracker\\.js|t/).*)", headers: security },
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
