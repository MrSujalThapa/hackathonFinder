"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CandidateCard } from "@/core/candidates/types";
import {
  CandidatesApiError,
  decideCandidate,
  fetchCandidates,
  type DecisionAction,
} from "@/lib/api/candidates";
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
};

const SESSION_SEEN_KEY = "hackathon-radar-queue-seen";

function readSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SESSION_SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function writeSeenIds(ids: Set<string>): void {
  sessionStorage.setItem(SESSION_SEEN_KEY, JSON.stringify([...ids]));
}

function messageForSheetSync(
  sheetSync: SheetSyncResult | null | undefined,
): string | null {
  if (!sheetSync) return null;
  switch (sheetSync.status) {
    case "failed":
      return "Approved; Sheet sync failed — retry from details.";
    case "appended":
    case "recovered_existing_row":
      return "Approved and added to Sheet.";
    case "mock_synced":
      return "Approved (mock Sheet sync — not written to Google).";
    case "already_synced":
      return "Already in Sheet.";
    default:
      return null;
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
  });
  const seenRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef(false);

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
      setState({
        candidates: filtered,
        total: filtered.length,
        loading: false,
        error: null,
        syncMessage: null,
        busy: false,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        busy: false,
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

  const decide = useCallback(
    async (action: QueueDecision, candidateId?: string) => {
      if (inflightRef.current) return { ok: false as const };
      const current = candidateId
        ? state.candidates.find((item) => item.id === candidateId)
        : state.candidates[0];
      if (!current) return { ok: false as const };

      inflightRef.current = true;
      setState((prev) => ({ ...prev, busy: true }));

      const previous = state.candidates;
      const remaining = previous.filter((item) => item.id !== current.id);
      seenRef.current.add(current.id);
      writeSeenIds(seenRef.current);

      setState((prev) => ({
        ...prev,
        candidates: remaining,
        total: Math.max(0, prev.total - 1),
      }));

      try {
        const { sheetSync } = await timedAsync("queue.decide_client", () =>
          decideCandidate(current.id, action),
        );
        const syncMessage =
          action === "approve" ? messageForSheetSync(sheetSync) : null;
        setState((prev) => ({
          ...prev,
          busy: false,
          syncMessage,
        }));
        inflightRef.current = false;
        return { ok: true as const, candidate: current, sheetSync };
      } catch (error) {
        seenRef.current.delete(current.id);
        writeSeenIds(seenRef.current);
        setState((prev) => ({
          ...prev,
          candidates: previous,
          total: previous.length,
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : "Decision failed — restored previous card",
        }));
        inflightRef.current = false;
        return { ok: false as const };
      }
    },
    [state.candidates],
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const clearSyncMessage = useCallback(() => {
    setState((prev) => ({ ...prev, syncMessage: null }));
  }, []);

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
  };
}
