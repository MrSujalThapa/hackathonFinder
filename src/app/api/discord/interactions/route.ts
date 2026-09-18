import { NextResponse } from "next/server";
import { getDiscordPublicKey, handleDiscordComponent, handleDiscordTextCommand, verifyDiscordRequest } from "@/server/notifications/discordInteractions";
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyDiscordRequest(request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"), raw, await getDiscordPublicKey())) return new NextResponse("invalid request signature", { status: 401 });
  const payload = JSON.parse(raw) as { type?: number; member?: { user?: { id?: string } }; user?: { id?: string }; data?: { custom_id?: string; name?: string; options?: Array<{ value?: string }> } };
  if (payload.type === 1) return NextResponse.json({ type: 1 });
  const userId = payload.member?.user?.id ?? payload.user?.id ?? "";
  const reply = payload.type === 3 && payload.data?.custom_id ? await handleDiscordComponent(userId, payload.data.custom_id) : await handleDiscordTextCommand(userId, [payload.data?.name, payload.data?.options?.[0]?.value].filter(Boolean).join(" "));
  return NextResponse.json({ type: 4, data: { content: reply.content, components: reply.components, flags: 64 } });
}
