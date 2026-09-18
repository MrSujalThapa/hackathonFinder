import { loadLocalEnv } from "@/cli/loadEnv";
import { markRuntimeService } from "@/cli/runtimeServiceState";
loadLocalEnv();
void import("@/server/notifications/discordGateway").then(({ runDiscordGatewayWorker }) => runDiscordGatewayWorker({ onReady: () => { console.log("[discord-worker] ready"); markRuntimeService("discord", "running", "gateway READY"); }, onEvent: (event) => console.log(`[discord-worker] ${event}`), onError: (error) => console.error("[discord-worker] handler", error instanceof Error ? error.message : error) })).catch((error) => { console.error("[discord-worker] fatal", error instanceof Error ? error.message : error); process.exit(1); });
