import type { CandidateCard, CandidateDetail } from "@/core/candidates/types";
import type { CandidateStatus } from "@/lib/supabase/database.types";
import { addSeenId, removeSeenId } from "@/lib/candidates/queueSeen";

export type HistoryBucket = "APPROVED" | "REJECTED" | "SAVED_FOR_LATER";

export type ClientStoreCounts = {
  queue: number;
  approved: number;
  rejected: number;
  saved: number;
};

export type ClientStoreSnapshot = {
  queue: CandidateCard[];
  approved: Map<string, CandidateCard>;
  rejected: Map<string, CandidateCard>;
  saved: Map<string, CandidateCard>;
  detailById: Map<string, CandidateDetail | CandidateCard>;
};

type Listener = () => void;

const CHANGE_EVENT = "change";

function isQueueStatus(status: CandidateStatus): boolean {
  return status === "NEW" || status === "NEEDS_REVIEW";
}

function historyBucket(status: CandidateStatus): HistoryBucket | null {
  if (status === "APPROVED") return "APPROVED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "SAVED_FOR_LATER") return "SAVED_FOR_LATER";
  return null;
}

function cloneMap<V>(map: Map<string, V>): Map<string, V> {
  return new Map(map);
}

class CandidateClientStore {
  private queue: CandidateCard[] = [];
  private approved = new Map<string, CandidateCard>();
  private rejected = new Map<string, CandidateCard>();
  private saved = new Map<string, CandidateCard>();
  private detailById = new Map<string, CandidateDetail | CandidateCard>();
  private bus = new EventTarget();
  private listeners = new Set<Listener>();

  private historyMap(bucket: HistoryBucket): Map<string, CandidateCard> {
    switch (bucket) {
      case "APPROVED":
        return this.approved;
      case "REJECTED":
        return this.rejected;
      case "SAVED_FOR_LATER":
        return this.saved;
    }
  }

  private notify(): void {
    this.bus.dispatchEvent(new Event(CHANGE_EVENT));
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    const onEvent = () => listener();
    this.bus.addEventListener(CHANGE_EVENT, onEvent);
    return () => {
      this.listeners.delete(listener);
      this.bus.removeEventListener(CHANGE_EVENT, onEvent);
    };
  }

  getQueue(): CandidateCard[] {
    return this.queue.slice();
  }

  getBucket(status: CandidateStatus): CandidateCard[] {
    if (isQueueStatus(status)) return this.getQueue();
    const bucket = historyBucket(status);
    if (!bucket) return [];
    return [...this.historyMap(bucket).values()];
  }

  getDetail(id: string): CandidateDetail | CandidateCard | undefined {
    return this.detailById.get(id);
  }

  getCounts(): ClientStoreCounts {
    return {
      queue: this.queue.length,
      approved: this.approved.size,
      rejected: this.rejected.size,
      saved: this.saved.size,
    };
  }

  snapshot(): ClientStoreSnapshot {
    return {
      queue: this.queue.slice(),
      approved: cloneMap(this.approved),
      rejected: cloneMap(this.rejected),
      saved: cloneMap(this.saved),
      detailById: cloneMap(this.detailById),
    };
  }

  restoreSnapshot(snap: ClientStoreSnapshot): void {
    this.queue = snap.queue.slice();
    this.approved = cloneMap(snap.approved);
    this.rejected = cloneMap(snap.rejected);
    this.saved = cloneMap(snap.saved);
    this.detailById = cloneMap(snap.detailById);
    this.notify();
  }

  replaceQueue(cards: CandidateCard[]): void {
    this.queue = cards.slice();
    this.notify();
  }

  replaceBucket(status: HistoryBucket, cards: CandidateCard[]): void {
    const map = this.historyMap(status);
    map.clear();
    for (const card of cards) {
      map.set(card.id, card);
    }
    this.notify();
  }

  setDetail(card: CandidateDetail | CandidateCard): void {
    this.detailById.set(card.id, card);
    this.notify();
  }

  private removeFromHistoryMaps(id: string): void {
    this.approved.delete(id);
    this.rejected.delete(id);
    this.saved.delete(id);
  }

  private removeFromQueueInternal(id: string): CandidateCard | undefined {
    const index = this.queue.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const [removed] = this.queue.splice(index, 1);
    return removed;
  }

  removeFromQueue(id: string): CandidateCard | undefined {
    const removed = this.removeFromQueueInternal(id);
    if (!removed) return undefined;
    if (removed.status === "NEW" || isQueueStatus(removed.status)) {
      addSeenId(id);
    }
    this.notify();
    return removed;
  }

  insertIntoQueue(card: CandidateCard): void {
    removeSeenId(card.id);
    this.removeFromHistoryMaps(card.id);
    this.queue = this.queue.filter((item) => item.id !== card.id);
    const queued: CandidateCard = {
      ...card,
      status: isQueueStatus(card.status) ? card.status : "NEW",
    };
    this.queue.unshift(queued);
    this.detailById.set(queued.id, {
      ...(this.detailById.get(queued.id) ?? {}),
      ...queued,
    } as CandidateDetail | CandidateCard);
    this.notify();
  }

  applyStatusChange(args: {
    id: string;
    previousStatus: CandidateStatus;
    newStatus: CandidateStatus;
    card: CandidateCard;
  }): void {
    const { id, previousStatus, newStatus, card } = args;
    const nextCard: CandidateCard = { ...card, status: newStatus };

    this.removeFromQueueInternal(id);
    this.removeFromHistoryMaps(id);

    if (isQueueStatus(newStatus)) {
      removeSeenId(id);
      this.queue = this.queue.filter((item) => item.id !== id);
      this.queue.unshift(nextCard);
    } else {
      if (isQueueStatus(previousStatus) || previousStatus === "NEW") {
        addSeenId(id);
      }
      const bucket = historyBucket(newStatus);
      if (bucket) {
        this.historyMap(bucket).set(id, nextCard);
      }
    }

    this.detailById.set(id, {
      ...(this.detailById.get(id) ?? {}),
      ...nextCard,
    } as CandidateDetail | CandidateCard);

    this.notify();
  }

  /** Test helper — clears all buckets. */
  reset(): void {
    this.queue = [];
    this.approved.clear();
    this.rejected.clear();
    this.saved.clear();
    this.detailById.clear();
    this.notify();
  }
}

const store = new CandidateClientStore();

export function subscribe(listener: Listener): () => void {
  return store.subscribe(listener);
}

export function getCounts(): ClientStoreCounts {
  return store.getCounts();
}

export function getQueue(): CandidateCard[] {
  return store.getQueue();
}

export function getBucket(status: CandidateStatus): CandidateCard[] {
  return store.getBucket(status);
}

export function getDetail(
  id: string,
): CandidateDetail | CandidateCard | undefined {
  return store.getDetail(id);
}

export function snapshot(): ClientStoreSnapshot {
  return store.snapshot();
}

export function restoreSnapshot(snap: ClientStoreSnapshot): void {
  store.restoreSnapshot(snap);
}

export function replaceQueue(cards: CandidateCard[]): void {
  store.replaceQueue(cards);
}

export function replaceBucket(
  status: HistoryBucket,
  cards: CandidateCard[],
): void {
  store.replaceBucket(status, cards);
}

export function setDetail(card: CandidateDetail | CandidateCard): void {
  store.setDetail(card);
}

export function removeFromQueue(id: string): CandidateCard | undefined {
  return store.removeFromQueue(id);
}

export function insertIntoQueue(card: CandidateCard): void {
  store.insertIntoQueue(card);
}

export function applyStatusChange(args: {
  id: string;
  previousStatus: CandidateStatus;
  newStatus: CandidateStatus;
  card: CandidateCard;
}): void {
  store.applyStatusChange(args);
}

export function resetClientStore(): void {
  store.reset();
}
