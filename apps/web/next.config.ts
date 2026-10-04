import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const analyticsSource = path.join(configDirectory, "../../packages/analytics/src/index.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
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
