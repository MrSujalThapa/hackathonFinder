export const SESSION_SEEN_KEY = "hackathon-radar-queue-seen";

export function readSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SESSION_SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function writeSeenIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_SEEN_KEY, JSON.stringify([...ids]));
}

export function addSeenId(id: string): void {
  const ids = readSeenIds();
  if (ids.has(id)) return;
  ids.add(id);
  writeSeenIds(ids);
}

export function removeSeenId(id: string): void {
  const ids = readSeenIds();
  if (!ids.has(id)) return;
  ids.delete(id);
  writeSeenIds(ids);
}

export function clearSeenIds(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_SEEN_KEY);
}

/** Remove a candidate from the session "seen" set so it can reappear in the queue. */
export function unseeCandidate(id: string): void {
  removeSeenId(id);
}
