import type { CompactCrawlProgressEvent, CrawlStopReason } from "@/crawl/types";

const PROGRESS_EVENT_MAX_BYTES = 512;

export function createProgressEvent(
  type: CompactCrawlProgressEvent["type"],
  unique: number,
  pagesOrScrolls: number,
  stopReason?: CrawlStopReason,
): CompactCrawlProgressEvent {
  const event: CompactCrawlProgressEvent = {
    type,
    unique: Math.max(0, Math.floor(unique)),
    pagesOrScrolls: Math.max(0, Math.floor(pagesOrScrolls)),
  };
  if (stopReason) event.stopReason = stopReason;
  return clampProgressEvent(event);
}

export function clampProgressEvent(
  event: CompactCrawlProgressEvent,
): CompactCrawlProgressEvent {
  let json = JSON.stringify(event);
  if (Buffer.byteLength(json, "utf8") <= PROGRESS_EVENT_MAX_BYTES) return event;
  const next: CompactCrawlProgressEvent = {
    type: event.type,
    unique: event.unique,
    pagesOrScrolls: event.pagesOrScrolls,
  };
  json = JSON.stringify(next);
  if (Buffer.byteLength(json, "utf8") <= PROGRESS_EVENT_MAX_BYTES) return next;
  return { type: event.type, unique: event.unique, pagesOrScrolls: 0 };
}

export function emitProgress(
  onProgress: ((event: CompactCrawlProgressEvent) => void) | undefined,
  event: CompactCrawlProgressEvent,
): void {
  if (!onProgress) return;
  onProgress(clampProgressEvent(event));
}
