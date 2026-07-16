import { candidateIdSchema, fail, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { getDiscoveryJobStore } from "@/jobs/store";
import { requireOwnerSession } from "@/app/api/discovery/_auth";
import type { DiscoveryEvent } from "@/discovery/events";
import type { DiscoveryJob } from "@/jobs/types";
import { compactJobForPoll } from "@/jobs/compactJob";

type RouteContext = { params: Promise<{ id: string }> };

const POLL_MS_MIN = 500;
const POLL_MS_MAX = 2_500;
const HEARTBEAT_MS = 15_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_EVENT = new Set(["run_completed", "run_failed", "run_cancelled"]);

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

  // Non-SSE JSON fallback for simple polling clients (cursor-based).
  if (url.searchParams.get("format") === "json") {
    const events = await store.listEvents(parsedId.data, {
      afterSequence,
      limit: 200,
    });
    const includeSummary = url.searchParams.get("summary") !== "0";
    return Response.json({
      data: {
        events,
        afterSequence:
          events.length > 0
            ? Math.max(afterSequence, ...events.map((event) => event.sequence))
            : afterSequence,
        job: includeSummary ? compactJobForPoll(job) : { id: job.id, status: job.status },
      },
      error: null,
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let pollMs = POLL_MS_MIN;
  let idleTicks = 0;

  const cleanup = () => {
    closed = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };

      send(`event: ready\ndata: ${JSON.stringify({ jobId: parsedId.data, afterSequence })}\n\n`);

      const finish = async (latest: DiscoveryJob) => {
        const rest = await store.listEvents(parsedId.data, {
          afterSequence,
          limit: 100,
        });
        for (const event of rest) {
          send(sseFormat(event));
          afterSequence = Math.max(afterSequence, event.sequence);
        }
        send(
          `event: end\ndata: ${JSON.stringify({
            status: latest.status,
            job: compactJobForPoll(latest),
          })}\n\n`,
        );
        closed = true;
        cleanup();
        controller.close();
      };

      const schedule = () => {
        if (closed) return;
        pollTimer = setTimeout(() => {
          void tick();
        }, pollMs);
      };

      const tick = async () => {
        if (closed) return;
        try {
          const events = await store.listEvents(parsedId.data, {
            afterSequence,
            limit: 100,
          });
          let sawTerminalEvent = false;
          for (const event of events) {
            send(sseFormat(event));
            afterSequence = Math.max(afterSequence, event.sequence);
            if (TERMINAL_EVENT.has(event.type)) sawTerminalEvent = true;
          }

          if (events.length > 0) {
            idleTicks = 0;
            pollMs = POLL_MS_MIN;
          } else {
            idleTicks += 1;
            pollMs = Math.min(POLL_MS_MAX, Math.round(pollMs * 1.5));
          }

          // Avoid refetching the full job on every quiet tick.
          const shouldCheckJob =
            sawTerminalEvent || idleTicks === 0 || idleTicks % 4 === 0 || idleTicks >= 6;
          if (shouldCheckJob) {
            const latest = await store.getJob(parsedId.data);
            if (latest && TERMINAL.has(latest.status)) {
              await finish(latest);
              return;
            }
          }

          schedule();
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
