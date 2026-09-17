import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createConnection } from "node:net";
import { join } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { getServerEnv, hasSupabaseConfig, resetServerEnvCacheForTests } from "@/config/env";

function running(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
const HEALTH_TIMEOUT_MS = 10_000;
type RuntimeState = { pid?: number; services?: Record<string, { status?: string; detail?: string }> };
function web(port: number): Promise<boolean> { return new Promise((resolve) => { const req = request({ host: "127.0.0.1", port, path: "/api/health", timeout: HEALTH_TIMEOUT_MS }, (res) => { res.resume(); resolve(res.statusCode === 200); }); req.on("error", () => resolve(false)); req.on("timeout", () => { req.destroy(); resolve(false); }); req.end(); }); }
function portInUse(port: number): Promise<boolean> { return new Promise((resolve) => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); socket.setTimeout(HEALTH_TIMEOUT_MS, () => { socket.destroy(); resolve(false); }); }); }

async function main(): Promise<void> {
  loadLocalEnv(); resetServerEnvCacheForTests(); const env = getServerEnv();
  const lockPath = join(process.cwd(), ".data", "hackfinder-runtime.json");
  let supervisor = false;
  if (existsSync(lockPath)) { try { supervisor = running((JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number }).pid); } catch { /* stale lock */ } }
  const statePath = join(process.cwd(), ".data", "hackfinder-runtime-state.json");
  let state: RuntimeState | null = null;
  if (supervisor && existsSync(statePath)) { try { state = JSON.parse(readFileSync(statePath, "utf8")) as RuntimeState; } catch { /* state is diagnostic only */ } }
  const service = (name: string, fallback: string) => {
    if (!supervisor) return "! runtime not active";
    const current = state?.services?.[name];
    if (!current) return `… ${fallback}`;
    if (current.status === "completed") return "✓ last pass complete";
    if (current.status === "running") return "✓ running";
    if (current.status === "starting") return "… starting";
    if (current.status === "retrying") return `! retrying (${current.detail ?? "last connection failed"})`;
    if (current.status === "failed") return `! last pass failed (${current.detail ?? "unknown"})`;
    return `! ${current.status ?? fallback}`;
  };
  console.log("HackFinder Local Status\n");
  const port = Number(process.env.PORT ?? 3000);
  const [webHealthy, listening] = await Promise.all([web(port), portInUse(port)]);
  console.log(`Web             ${webHealthy ? "✓ healthy" : listening ? `! port ${port} is listening but /api/health is unhealthy` : "! not listening"}`);
  console.log(`Supabase        ${hasSupabaseConfig(env) ? "✓ configured" : "! missing configuration"}`);
  console.log(`Discord         ${env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID && env.DISCORD_USER_ID ? service("discord", "configured") : "! not configured"}`);
  console.log(`Discovery       ${service("discovery", "scheduler supervised")}`);
  console.log(`Tracker         ${service("application tracker", "scheduler supervised")}`);
  console.log(`Tailscale URL   ${env.APP_BASE_URL ? `✓ configured (${env.APP_BASE_URL})` : "! APP_BASE_URL missing"}`);
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
