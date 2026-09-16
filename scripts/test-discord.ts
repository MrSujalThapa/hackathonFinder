import { loadLocalEnv } from "@/cli/loadEnv";
loadLocalEnv();
async function main(): Promise<void> {
  const result = await (await import("@/server/notifications/service")).sendDiscord({ type: "APPLICATION_OPEN", priority: 2, applicationId: "00000000-0000-0000-0000-000000000001", title: "Pass 1 notification test", body: "Safe test: no application action was taken.", actionUrl: "/drafts" });
  if (!result) throw new Error("Discord bot token or channel ID is not configured.");
  console.log(JSON.stringify({ delivered: true, messageId: result.id, deepLinkIncluded: Boolean(result.actionUrl), actionRowIncluded: result.componentCount > 0 }));
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
