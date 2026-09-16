import { loadLocalEnv } from "@/cli/loadEnv";
loadLocalEnv();
void import("@/server/notifications/discordGateway").then(({ runDiscordGatewayWorker }) => runDiscordGatewayWorker({ onReady: () => console.log("[discord-worker] ready"), onEvent: (event) => console.log(`[discord-worker] ${event}`) })).catch((error) => { console.error("[discord-worker] fatal", error instanceof Error ? error.message : error); process.exit(1); });
