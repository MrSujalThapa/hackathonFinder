/**
 * Local-first HackFinder supervisor. This intentionally remains a small process
 * wrapper around the existing web, Discord, and one-shot worker entrypoints.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createConnection } from "node:net";
import { join } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { getServerEnv, resetServerEnvCacheForTests } from "@/config/env";

const root = process.cwd();
const lockPath = join(root, ".data", "hackfinder-runtime.json");
let webPort = 3000;
let discoveryEveryMs = 6 * 60 * 60 * 1000;
let trackerEveryMs = 60 * 60 * 1000;
const children = new Set<ChildProcess>();
const restartTimers = new Set<NodeJS.Timeout>();
let stopping = false;
const HEALTH_TIMEOUT_MS = 10_000;

type RuntimeLock = { pid: number; startedAt: string };

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock(): void {
  mkdirSync(join(root, ".data"), { recursive: true });
  if (existsSync(lockPath)) {
    try {
      const prior = JSON.parse(readFileSync(lockPath, "utf8")) as RuntimeLock;
      if (Number.isInteger(prior.pid) && processExists(prior.pid)) {
        throw new Error(`HackFinder local runtime is already active (pid ${prior.pid}). Use npm run hackfinder:status.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("HackFinder")) throw error;
    }
    try { unlinkSync(lockPath); } catch { /* another supervisor owns it */ }
  }
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
}

function releaseLock(): void {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as RuntimeLock;
    if (lock.pid === process.pid) unlinkSync(lockPath);
  } catch { /* nothing to release */ }
}

function isWebRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port: webPort, path: "/api/health", timeout: HEALTH_TIMEOUT_MS }, (response) => {
      response.resume(); resolve(response.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/** A listener, even one with a bad health response, owns the configured port. */
function isPortInUse(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: webPort });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(HEALTH_TIMEOUT_MS, () => { socket.destroy(); resolve(false); });
  });
}

function start(name: string, args: string[]): ChildProcess {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  // Windows command shims (`npm.cmd`) require a shell. On POSIX, keep the
  // direct spawn so signals remain attached to the exact child process.
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) console.log(`[runtime] ${name} exited (${signal ?? code ?? "unknown"})`);
  });
  return child;
}

/** Keep the gateway available after a transient Discord/Tailscale outage. */
function startPersistent(name: string, script: string): void {
  const launch = () => {
    if (stopping) return;
    const child = start(name, ["run", script]);
    child.once("exit", () => {
      if (stopping) return;
      console.warn(`[runtime] ${name} will retry in 10 seconds`);
      const retry = setTimeout(() => {
        restartTimers.delete(retry);
        launch();
      }, 10_000);
      restartTimers.add(retry);
    });
  };
  launch();
}

async function runOnce(name: string, script: string): Promise<void> {
  if (stopping) return;
  console.log(`[runtime] ${name} started`);
  await new Promise<void>((resolve) => {
    const child = start(name, ["run", script]);
    child.once("exit", () => resolve());
  });
}

function schedule(name: string, script: string, interval: number): NodeJS.Timeout {
  void runOnce(name, script);
  return setInterval(() => void runOnce(name, script), interval);
}

async function main(): Promise<void> {
  loadLocalEnv(); resetServerEnvCacheForTests();
  webPort = Number(process.env.PORT ?? 3000);
  discoveryEveryMs = Number(process.env.HACKFINDER_DISCOVERY_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
  trackerEveryMs = Number(process.env.HACKFINDER_TRACKER_INTERVAL_MS ?? 60 * 60 * 1000);
  const env = getServerEnv();
  acquireLock();
  const [alreadyRunning, portInUse] = await Promise.all([isWebRunning(), isPortInUse()]);
  console.log("\nHackFinder Local Runtime\n");
  console.log(`${alreadyRunning ? "✓" : portInUse ? "!" : "…"} Web ${alreadyRunning ? `healthy on :${webPort}` : portInUse ? `port :${webPort} is already in use; not starting a duplicate` : `starting on :${webPort}`}`);
  console.log(`${env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID && env.DISCORD_USER_ID ? "✓" : "!"} Discord ${env.DISCORD_BOT_TOKEN ? "configured" : "not configured"}`);
  console.log("✓ Discovery scheduler every 6 hours (configurable)");
  console.log("✓ Application tracker every hour (configurable)");
  console.log(`${env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? "✓" : "!"} Supabase ${env.NEXT_PUBLIC_SUPABASE_URL ? "configured" : "not configured"}`);
  console.log(`${env.APP_BASE_URL ? "✓" : "!"} Tailscale URL/config ${env.APP_BASE_URL ?? "APP_BASE_URL not configured"}\n`);

  if (!portInUse) start("web", ["run", "dev"]);
  if (env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID && env.DISCORD_CHANNEL_ID && env.DISCORD_USER_ID) startPersistent("discord", "worker:discord");
  const timers = [
    schedule("discovery", "worker:discovery:scheduled", discoveryEveryMs),
    schedule("application tracker", "worker:applications:once", trackerEveryMs),
  ];
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[runtime] ${signal} received — stopping child services…`);
    timers.forEach(clearInterval);
    restartTimers.forEach(clearTimeout);
    restartTimers.clear();
    for (const child of children) child.kill("SIGTERM");
    setTimeout(() => { for (const child of children) child.kill("SIGKILL"); releaseLock(); process.exit(0); }, 8_000).unref();
    if (children.size === 0) { releaseLock(); process.exit(0); }
  };
  process.on("SIGINT", () => shutdown("Ctrl+C"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error) => { console.error(`[runtime] ${error instanceof Error ? error.message : error}`); releaseLock(); process.exit(1); });
