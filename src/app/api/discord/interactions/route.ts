import { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { handleDiscordComponent, handleDiscordTextCommand, verifyDiscordRequest } from "@/server/notifications/discordInteractions";
export async function POST(request: Request) {
  const raw = await request.text(); const env = getServerEnv();
  if (!verifyDiscordRequest(request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"), raw, env.DISCORD_PUBLIC_KEY)) return new NextResponse("invalid request signature", { status: 401 });
  const payload = JSON.parse(raw) as { type?: number; member?: { user?: { id?: string } }; user?: { id?: string }; data?: { custom_id?: string; name?: string; options?: Array<{ value?: string }> } };
  if (payload.type === 1) return NextResponse.json({ type: 1 });
  const userId = payload.member?.user?.id ?? payload.user?.id ?? "";
  const content = payload.type === 3 && payload.data?.custom_id ? await handleDiscordComponent(userId, payload.data.custom_id) : await handleDiscordTextCommand(userId, [payload.data?.name, payload.data?.options?.[0]?.value].filter(Boolean).join(" "));
  return NextResponse.json({ type: 4, data: { content, flags: 64 } });
}
