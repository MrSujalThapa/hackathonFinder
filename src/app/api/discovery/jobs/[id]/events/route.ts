import { candidateIdSchema, fail, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { getDiscoveryJobStore } from "@/jobs/store";
import { requireOwnerSession } from "@/app/api/discovery/_auth";
import type { DiscoveryEvent } from "@/discovery/events";

type RouteContext = { params: Promise<{ id: string }> };

const HEARTBEAT_MS = 15_000;
const POLL_MS = 500;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function sseFormat(event: DiscoveryEvent): string {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const auth = await requireOwnerSession(request);
  if (auth) return auth;

  const protection = protectApiRequest(request, {
    rateLimit: { key: "discovery-job-events", limit: 60, windowMs: 60_000 },
  });
  if (protection) return protection;

  const { id } = await context.params;
  const parsedId = candidateIdSchema.safeParse(id);
  if (!parsedId.success) return validationError(parsedId.error);

  const store = getDiscoveryJobStore();
  const job = await store.getJob(parsedId.data);
  if (!job) return fail("CANDIDATE_NOT_FOUND", "Discovery job not found", 404);

  const url = new URL(request.url);
  const lastEventHeader = request.headers.get("last-event-id");
  const afterParam = url.searchParams.get("after");
  let afterSequence = Number(lastEventHeader ?? afterParam ?? 0);
  if (!Number.isFinite(afterSequence) || afterSequence < 0) afterSequence = 0;

  // Non-SSE JSON fallback for simple polling clients.
  if (url.searchParams.get("format") === "json") {
    const events = await store.listEvents(parsedId.data, {
      afterSequence,
      limit: 200,
    });
    return Response.json({ data: { events, job }, error: null });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const cleanup = () => {
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };

      send(`event: ready\ndata: ${JSON.stringify({ jobId: parsedId.data, afterSequence })}\n\n`);

      const tick = async () => {
        if (closed) return;
        try {
          const events = await store.listEvents(parsedId.data, {
            afterSequence,
            limit: 100,
          });
          for (const event of events) {
            send(sseFormat(event));
            afterSequence = Math.max(afterSequence, event.sequence);
          }

          const latest = await store.getJob(parsedId.data);
          if (latest && TERMINAL.has(latest.status)) {
            // Flush any remaining events once more.
            const rest = await store.listEvents(parsedId.data, {
              afterSequence,
              limit: 100,
            });
            for (const event of rest) {
              send(sseFormat(event));
              afterSequence = Math.max(afterSequence, event.sequence);
            }
            send(
              `event: end\ndata: ${JSON.stringify({ status: latest.status })}\n\n`,
            );
            closed = true;
            cleanup();
            controller.close();
          }
        } catch (error) {
          send(
            `event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : "stream error",
            })}\n\n`,
          );
          closed = true;
          cleanup();
          controller.close();
        }
      };

      pollTimer = setInterval(() => {
        void tick();
      }, POLL_MS);
      heartbeatTimer = setInterval(() => {
        send(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      void tick();

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
