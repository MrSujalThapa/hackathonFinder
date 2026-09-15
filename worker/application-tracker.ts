import { runApplicationTracker } from "@/server/applications/tracker";
void runApplicationTracker().then((result) => console.log(`[application-tracker] notifications=${result.notifications}`)).catch((error) => { console.error("[application-tracker] fatal", error instanceof Error ? error.message : error); process.exit(1); });
