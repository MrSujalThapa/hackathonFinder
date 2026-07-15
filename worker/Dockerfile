# Discovery worker image (skeleton — do not deploy in this phase).
# Includes Playwright Chromium deps for Hakku/browser collectors.

FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

ENV NODE_ENV=production \
    DISCOVERY_EXECUTION_MODE=worker \
    BROWSER_PROFILE_ROOT=/data/browser-profiles \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
# Keep tsx available for the skeleton entrypoint (compile step comes later).
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY worker ./worker

# Persistent browser profiles (Hakku) — mount a volume at runtime.
VOLUME ["/data/browser-profiles"]

EXPOSE 8089

# Lightweight health listener + worker loop
CMD ["npx", "tsx", "worker/index.ts"]
