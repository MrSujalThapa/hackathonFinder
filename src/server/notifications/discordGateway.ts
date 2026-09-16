import { getServerEnv } from "@/config/env";
import { handleDiscordComponent, handleDiscordTextCommand } from "@/server/notifications/discordInteractions";

type GatewayPayload = { op: number; d: Record<string, unknown> | null; s?: number | null; t?: string | null };
type GatewayOptions = { onReady?: () => void; onEvent?: (name: string) => void; onError?: (error: unknown) => void };

async function discordFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const env = getServerEnv(); return fetch(`https://discord.com/api/v10${path}`, { ...init, headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
async function replyToInteraction(id: string, token: string, reply: { content: string; components?: unknown[] }): Promise<void> {
  await discordFetch(`/interactions/${id}/${token}/callback`, { method: "POST", body: JSON.stringify({ type: 4, data: { content: reply.content, components: reply.components, flags: 64, allowed_mentions: { parse: [] } } }) });
}
async function replyToMessage(channelId: string, content: string): Promise<void> {
  await discordFetch(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
}

/** Persistent local Gateway worker. No HTTP interactions endpoint or deployment is required. */
export async function runDiscordGatewayWorker(options: GatewayOptions = {}): Promise<void> {
  const env = getServerEnv(); if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_CHANNEL_ID || !env.DISCORD_USER_ID) throw new Error("Discord Gateway worker requires token, guild, channel, and owner user ID.");
  const channelId = env.DISCORD_CHANNEL_ID;
  const gateway = await discordFetch("/gateway/bot").then(async (response) => { if (!response.ok) throw new Error(`Discord gateway discovery failed (${response.status}).`); return response.json() as Promise<{ url: string }>; });
  const socket = new WebSocket(`${gateway.url}?v=10&encoding=json`); let heartbeat: ReturnType<typeof setInterval> | undefined; let sequence: number | null = null;
  socket.addEventListener("message", (message) => { void (async () => {
    const payload = JSON.parse(String(message.data)) as GatewayPayload; if (payload.s !== undefined && payload.s !== null) sequence = payload.s;
    if (payload.op === 10) { const interval = Number(payload.d?.heartbeat_interval ?? 45_000); socket.send(JSON.stringify({ op: 2, d: { token: env.DISCORD_BOT_TOKEN, intents: 33281, properties: { os: process.platform, browser: "hackfinder", device: "hackfinder" } } })); heartbeat = setInterval(() => socket.send(JSON.stringify({ op: 1, d: sequence })), interval); return; }
    if (payload.t === "READY") { options.onReady?.(); return; }
    if (payload.t === "MESSAGE_CREATE") { const d = payload.d ?? {}; if (d.channel_id !== channelId || d.author && typeof d.author === "object" && (d.author as { bot?: boolean }).bot) return; options.onEvent?.("MESSAGE_CREATE"); const authorId = (d.author as { id?: string } | undefined)?.id ?? ""; const content = typeof d.content === "string" ? d.content : ""; const reply = await handleDiscordTextCommand(authorId, content); await replyToMessage(channelId, reply); return; }
    if (payload.t === "INTERACTION_CREATE") { const d = payload.d ?? {}; const customId = (d.data as { custom_id?: string } | undefined)?.custom_id; if (!customId) return; options.onEvent?.("INTERACTION_CREATE"); const userId = ((d.member as { user?: { id?: string } } | undefined)?.user?.id) ?? (d.user as { id?: string } | undefined)?.id ?? ""; const reply = await handleDiscordComponent(userId, customId); await replyToInteraction(String(d.id), String(d.token), reply); }
  })().catch((error) => options.onError?.(error)); });
  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error("Discord Gateway connection failed.")), { once: true }); });
  await new Promise<void>((resolve) => socket.addEventListener("close", () => { if (heartbeat) clearInterval(heartbeat); resolve(); }, { once: true }));
}
