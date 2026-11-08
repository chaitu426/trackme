import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

// Next only loads .env files from this app's directory, but the repo keeps one .env at
// the root. Without it NEXT_PUBLIC_DASHBOARD_URL is missing, so the landing page loses
// its dashboard links and the session check below it cannot run.
try {
  process.loadEnvFile?.(path.join(configDirectory, "../../.env"));
} catch {
  // No root .env (CI, container): real environment variables apply.
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@trackme/landing"],
};

export default nextConfig;

