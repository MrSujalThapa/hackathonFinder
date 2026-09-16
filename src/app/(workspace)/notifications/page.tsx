import { NotificationInbox } from "@/components/applications/NotificationInbox";
import { listNotifications } from "@/server/notifications/service";
export default async function NotificationsPage() { const notifications = await listNotifications(); return <section className="mx-auto max-w-4xl space-y-5"><header><p className="font-mono text-xs text-muted">APPLICATION ACTIVITY</p><h1 className="hf-doc-title text-3xl">Notifications</h1></header><NotificationInbox initialItems={notifications} /></section>; }
