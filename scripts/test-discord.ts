import { loadLocalEnv } from "@/cli/loadEnv";
loadLocalEnv();
async function main(): Promise<void> {
  const applicationId = process.env.DISCORD_TEST_APPLICATION_ID ?? "00000000-0000-0000-0000-000000000001";
  const result = await (await import("@/server/notifications/service")).sendDiscord({ type: "APPLICATION_OPEN", priority: 2, applicationId, title: "Pass 1 notification test", body: "Safe test: no application action was taken.", actionUrl: `/drafts/${applicationId}` });
  if (!result) throw new Error("Discord bot token or channel ID is not configured.");
  console.log(JSON.stringify({ delivered: true, messageId: result.id, deepLinkIncluded: Boolean(result.actionUrl), actionRowIncluded: result.componentCount > 0 }));
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
