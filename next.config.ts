import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Generic V2 is optional/disabled-by-default and pulls Crawlee/Puppeteer.
  // Keep those packages external to the Next.js server bundle.
  serverExternalPackages: [
    "crawlee",
    "@crawlee/core",
    "@crawlee/browser",
    "@crawlee/puppeteer",
    "@crawlee/playwright",
    "@crawlee/jsdom",
    "@crawlee/cheerio",
    "@crawlee/basic",
    "@crawlee/http",
    "@crawlee/browser-pool",
    "puppeteer",
    "playwright",
    "playwright-core",
  ],
};

export default nextConfig;
