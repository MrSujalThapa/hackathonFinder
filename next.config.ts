import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep browser automation packages external to the Next.js server bundle.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
