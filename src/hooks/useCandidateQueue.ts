"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CandidateCard } from "@/core/candidates/types";
import {
  CandidatesApiError,
  decideCandidate,
  fetchCandidates,
  syncCandidateSheet,
  type DecisionAction,
} from "@/lib/api/candidates";
import {
  applyStatusChange,
  getCounts,
  getQueue,
  insertIntoQueue,
  replaceQueue,
  rollbackCandidateChange,
  subscribe,
} from "@/lib/candidates/clientStore";
import {
  addSeenId,
  clearSeenIds,
  readSeenIds,
  removeSeenId,
  unseeCandidate,
  writeSeenIds,
} from "@/lib/candidates/queueSeen";
import { timedAsync } from "@/lib/perf/timing";
import type { SheetSyncResult } from "@/server/sheets/types";

export type QueueDecision = Exclude<DecisionAction, "restore">;

type QueueState = {
  candidates: CandidateCard[];
  total: number;
  loading: boolean;
  error: string | null;
  syncMessage: string | null;
  busy: boolean;
  outgoingId: string | null;
  loadingMore: boolean;
};

const QUEUE_BATCH_SIZE = 30;
const QUEUE_REFILL_THRESHOLD = 8;
const QUEUE_STATUSES = ["NEW", "NEEDS_REVIEW"] as const;

export function messageForSheetSync(
  sheetSync: SheetSyncResult | null | undefined,
): string | null {
  if (!sheetSync) return null;
  const status = sheetSync.status as string;
  switch (status) {
    case "failed":
      return "Approved; Sheet sync failed — retry from details.";
    case "appended":
    case "recovered_existing_row":
      return "Approved and added to Sheet.";
    case "mock_synced":
      return "Approved (mock Sheet sync — not written to Google).";
    case "already_synced":
      return "Already in Sheet.";
    case "deleted":
    case "already_absent":
      return "Sheet row removed (or already absent).";
    case "already_present":
      return "Already in Sheet.";
    case "mock_cleared":
      return "Sheet row cleared (mock).";
    default:
      return null;
  }
}

function statusForDecision(action: QueueDecision): CandidateCard["status"] {
  switch (action) {
    case "approve":
      return "APPROVED";
    case "reject":
      return "REJECTED";
    case "save":
      return "SAVED_FOR_LATER";
  }
}

export function useCandidateQueue() {
  const [state, setState] = useState<QueueState>({
    candidates: [],
    total: 0,
    loading: true,
    error: null,
    syncMessage: null,
    busy: false,
    outgoingId: null,
    loadingMore: false,
  });
  const seenRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const candidatesRef = useRef<CandidateCard[]>([]);
  const cursorRef = useRef<string | null>(null);
  const exhaustedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const totalRef = useRef(0);

  useEffect(() => {
    candidatesRef.current = state.candidates;
  }, [state.candidates]);

  useEffect(() => {
    totalRef.current = state.total;
  }, [state.total]);

  const syncLocalFromStore = useCallback(() => {
    const pending = pendingRef.current;
    const storeQueue = getQueue().filter((card) => !pending.has(card.id));
    setState((prev) => ({
      ...prev,
      candidates: storeQueue,
      total: getCounts().queue,
    }));
  }, []);

  const mergeFetchedCandidates = useCallback(
    (incoming: CandidateCard[], total: number | null | undefined) => {
      const seen = seenRef.current;
      const pending = pendingRef.current;
      const byId = new Map(candidatesRef.current.map((card) => [card.id, card]));
      for (const candidate of incoming) {
        if (seen.has(candidate.id) || pending.has(candidate.id)) continue;
        if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
      }
      const next = [...byId.values()].sort(
        (a, b) =>
          b.score - a.score ||
          b.foundAt.localeCompare(a.foundAt) ||
          b.id.localeCompare(a.id),
      );
      const authoritativeTotal = total ?? totalRef.current;
      candidatesRef.current = next;
      totalRef.current = authoritativeTotal;
      replaceQueue(next, authoritativeTotal);
      setState((prev) => ({
        ...prev,
        candidates: next,
        total: authoritativeTotal,
        loading: false,
        loadingMore: false,
        error: null,
      }));
    },
    [],
  );

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || exhaustedRef.current) return;
    loadingMoreRef.current = true;
    setState((prev) => ({ ...prev, loadingMore: true }));
    try {
      const page = await timedAsync("queue.fetch_more", () =>
        fetchCandidates({
          statuses: [...QUEUE_STATUSES],
          limit: QUEUE_BATCH_SIZE,
          sort: "score",
          cursor: cursorRef.current ?? undefined,
        }),
      );
      cursorRef.current = page.nextCursor;
      exhaustedRef.current = !page.nextCursor;
      mergeFetchedCandidates(page.candidates, page.total);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        error:
          error instanceof CandidatesApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to load more queue candidates",
      }));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [mergeFetchedCandidates]);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      cursorRef.current = null;
      exhaustedRef.current = false;
      loadingMoreRef.current = false;
      const firstPage = await timedAsync("queue.initial_fetch", async () => {
        return fetchCandidates({
          statuses: [...QUEUE_STATUSES],
          limit: QUEUE_BATCH_SIZE,
          sort: "score",
        });
      });
      cursorRef.current = firstPage.nextCursor;
      exhaustedRef.current = !firstPage.nextCursor;
      const seen = seenRef.current;
      const filtered = firstPage.candidates.filter((candidate) => !seen.has(candidate.id));
      const total = firstPage.total ?? filtered.length;
      candidatesRef.current = filtered;
      totalRef.current = total;
      replaceQueue(filtered, total);
      setState({
        candidates: filtered,
        total,
        loading: false,
        error: null,
        syncMessage: null,
        busy: false,
        outgoingId: null,
        loadingMore: false,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        busy: false,
        outgoingId: null,
        error:
          error instanceof CandidatesApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to load queue",
      }));
    }
  }, []);

  useEffect(() => {
    seenRef.current = readSeenIds();
    void load();
  }, [load]);

  useEffect(() => {
    return subscribe(() => {
      const storeQueue = getQueue();
      const pending = pendingRef.current;
      const local = candidatesRef.current;
      const localIds = new Set(local.map((item) => item.id));

      for (const card of storeQueue) {
        if (pending.has(card.id)) continue;
        if (!localIds.has(card.id)) {
          removeSeenId(card.id);
          seenRef.current.delete(card.id);
          writeSeenIds(seenRef.current);
        }
      }

      const next = storeQueue.filter((card) => !pending.has(card.id));
      const same =
        next.length === local.length &&
        next.every((card, index) => card.id === local[index]?.id);
      if (same) return;

      setState((prev) => ({
        ...prev,
        candidates: next,
        total: getCounts().queue,
      }));
    });
  }, []);

  useEffect(() => {
    if (
      !state.loading &&
      !state.loadingMore &&
      state.candidates.length > 0 &&
      state.candidates.length <= QUEUE_REFILL_THRESHOLD &&
      state.candidates.length < state.total
    ) {
      void loadMore();
    }
  }, [loadMore, state.candidates.length, state.loading, state.loadingMore, state.total]);

  const decide = useCallback(
    async (action: QueueDecision, candidateId?: string) => {
      const current = candidateId
        ? candidatesRef.current.find((item) => item.id === candidateId)
        : candidatesRef.current[0];
      if (!current) return { ok: false as const };
      if (pendingRef.current.has(current.id)) return { ok: false as const };

      const previousStatus = current.status;
      const previousTotal = totalRef.current;
      const newStatus = statusForDecision(action);
      const optimisticCard: CandidateCard = {
        ...current,
        status: newStatus,
      };

      pendingRef.current.add(current.id);
      seenRef.current.add(current.id);
      addSeenId(current.id);
      writeSeenIds(seenRef.current);

      const previousLocal = candidatesRef.current;
      applyStatusChange({
        id: current.id,
        previousStatus,
        newStatus,
        card: optimisticCard,
      });

      const remaining = previousLocal.filter((item) => item.id !== current.id);
      candidatesRef.current = remaining;
      totalRef.current = Math.max(0, previousTotal - 1);
      setState((prev) => ({
        ...prev,
        candidates: remaining,
        total: Math.max(0, prev.total - 1),
        busy: false,
        outgoingId: null,
        error: null,
      }));
      if (remaining.length <= QUEUE_REFILL_THRESHOLD) {
        void loadMore();
      }

      try {
        const { candidate: updated } = await timedAsync(
          "queue.decide_client",
          () => decideCandidate(current.id, action),
        );

        applyStatusChange({
          id: current.id,
          previousStatus,
          newStatus: updated.status,
          card: updated,
        });
        pendingRef.current.delete(current.id);

        if (action === "approve") {
          void timedAsync("queue.sheet_sync_bg", () =>
            syncCandidateSheet(current.id),
          )
            .then(({ sheetSync }) => {
              setState((prev) => ({
                ...prev,
                syncMessage: messageForSheetSync(sheetSync),
              }));
            })
            .catch((error: unknown) => {
              setState((prev) => ({
                ...prev,
                syncMessage:
                  error instanceof Error
                    ? `Approved; Sheet sync failed — ${error.message}`
                    : "Approved; Sheet sync failed — retry from details.",
              }));
            });
        } else {
          void syncCandidateSheet(current.id)
            .then(({ sheetSync }) => {
              if (sheetSync.status === "failed") {
                setState((prev) => ({
                  ...prev,
                  syncMessage:
                    sheetSync.message ??
                    "Status updated; Sheet cleanup failed — retry from details.",
                }));
              }
            })
            .catch(() => {
              setState((prev) => ({
                ...prev,
                syncMessage:
                  "Status updated; Sheet cleanup failed — retry from details.",
              }));
            });
        }

        return { ok: true as const, candidate: updated, sheetSync: null };
      } catch (error) {
        pendingRef.current.delete(current.id);
        seenRef.current.delete(current.id);
        removeSeenId(current.id);
        writeSeenIds(seenRef.current);
        // Scoped rollback — do not wipe unrelated concurrent decisions.
        rollbackCandidateChange({
          id: current.id,
          previousStatus,
          card: optimisticCard,
        });
        candidatesRef.current = previousLocal;
        totalRef.current = previousTotal;
        setState((prev) => ({
          ...prev,
          candidates: previousLocal,
          total: previousTotal,
          busy: false,
          outgoingId: null,
          error:
            error instanceof Error
              ? error.message
              : "Decision failed — restored previous card",
        }));
        return { ok: false as const };
      }
    },
    [loadMore],
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const clearSyncMessage = useCallback(() => {
    setState((prev) => ({ ...prev, syncMessage: null }));
  }, []);

  const isPending = useCallback((id: string) => pendingRef.current.has(id), []);

  return {
    ...state,
    current: state.candidates[0] ?? null,
    upcoming: state.candidates[1] ?? null,
    position: state.candidates.length ? 1 : 0,
    refresh: load,
    decide,
    clearError,
    clearSyncMessage,
    isPending,
    unsee: unseeCandidate,
    insertIntoQueue,
    clearSeenIds,
    syncLocalFromStore,
  };
}
