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
  getQueue,
  insertIntoQueue,
  replaceQueue,
  restoreSnapshot,
  snapshot,
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
};

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
  });
  const seenRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const candidatesRef = useRef<CandidateCard[]>([]);

  useEffect(() => {
    candidatesRef.current = state.candidates;
  }, [state.candidates]);

  const syncLocalFromStore = useCallback(() => {
    const pending = pendingRef.current;
    const storeQueue = getQueue().filter((card) => !pending.has(card.id));
    setState((prev) => ({
      ...prev,
      candidates: storeQueue,
      total: storeQueue.length,
    }));
  }, []);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const filtered = await timedAsync("queue.initial_fetch", async () => {
        const [newBatch, reviewBatch] = await Promise.all([
          fetchCandidates({ status: "NEW", limit: 30, sort: "score" }),
          fetchCandidates({ status: "NEEDS_REVIEW", limit: 30, sort: "score" }),
        ]);
        const merged = [...newBatch.candidates, ...reviewBatch.candidates]
          .filter(
            (candidate, index, all) =>
              all.findIndex((item) => item.id === candidate.id) === index,
          )
          .sort(
            (a, b) =>
              b.score - a.score ||
              b.foundAt.localeCompare(a.foundAt) ||
              a.id.localeCompare(b.id),
          );
        const seen = seenRef.current;
        return merged.filter((candidate) => !seen.has(candidate.id));
      });
      replaceQueue(filtered);
      setState({
        candidates: filtered,
        total: filtered.length,
        loading: false,
        error: null,
        syncMessage: null,
        busy: false,
        outgoingId: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
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
        total: next.length,
      }));
    });
  }, []);

  const decide = useCallback(
    async (action: QueueDecision, candidateId?: string) => {
      const current = candidateId
        ? candidatesRef.current.find((item) => item.id === candidateId)
        : candidatesRef.current[0];
      if (!current) return { ok: false as const };
      if (pendingRef.current.has(current.id)) return { ok: false as const };

      const previousStatus = current.status;
      const newStatus = statusForDecision(action);
      const optimisticCard: CandidateCard = {
        ...current,
        status: newStatus,
      };

      pendingRef.current.add(current.id);
      seenRef.current.add(current.id);
      addSeenId(current.id);
      writeSeenIds(seenRef.current);

      const storeSnap = snapshot();
      const previousLocal = candidatesRef.current;
      applyStatusChange({
        id: current.id,
        previousStatus,
        newStatus,
        card: optimisticCard,
      });

      const remaining = previousLocal.filter((item) => item.id !== current.id);
      setState((prev) => ({
        ...prev,
        candidates: remaining,
        total: Math.max(0, prev.total - 1),
        busy: false,
        outgoingId: null,
        error: null,
      }));

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
          // Leave-APPROVED (or any non-approve) may need Sheet row removal.
          void syncCandidateSheet(current.id).catch(() => undefined);
        }

        return { ok: true as const, candidate: updated, sheetSync: null };
      } catch (error) {
        pendingRef.current.delete(current.id);
        seenRef.current.delete(current.id);
        removeSeenId(current.id);
        writeSeenIds(seenRef.current);
        restoreSnapshot(storeSnap);
        setState((prev) => ({
          ...prev,
          candidates: previousLocal,
          total: previousLocal.length,
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
    [],
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
    position: state.candidates.length
      ? state.total - state.candidates.length + 1
      : 0,
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
