import { randomUUID } from "node:crypto";
import type {
  AddActionInput,
  AddCandidateAnswerInput,
  CandidateAction,
  CandidateCard,
  CandidateDetail,
  ListCandidatesParams,
  ListCandidatesResult,
  StatusChangeMetadata,
} from "@/core/candidates/types";
import type { CandidateStatus } from "@/lib/supabase/database.types";
import type { CandidateRepository } from "@/server/candidates/service";

type MockRecord = CandidateDetail & {
  approvedAt: string | null;
  rejectedAt: string | null;
  savedAt: string | null;
};

const GLOBAL_KEY = "__hackathonRadarMockCandidates__";

function seedCandidates(): MockRecord[] {
  const now = "2026-07-01T12:00:00.000Z";
  const seeds: Array<Omit<MockRecord, "id" | "actions" | "evidence" | "answers">> = [
    {
      status: "NEW",
      score: 86,
      name: "HackTO AI Challenge",
      summary:
        "Toronto AI hackathon focused on agents and cloud tooling. Build something useful in a weekend.",
      source: "mock",
      officialUrl: "https://hackto.example.com/ai-challenge",
      applyUrl: "https://hackto.example.com/ai-challenge/apply",
      socialUrl: null,
      startDate: "2026-09-13",
      endDate: "2026-09-15",
      deadline: "2026-08-15",
      location: "Toronto, Canada",
      mode: "in-person",
      city: "Toronto",
      country: "Canada",
      prize: "$10,000 in prizes",
      themes: ["AI", "agents", "cloud"],
      eligibility: "Open to students and professionals in Canada",
      whyMatch: ["Matches AI theme preference", "Toronto location"],
      redFlags: [],
      foundAt: now,
      lastVerified: now,
      sheetRowId: null,
      sheetAppendedAt: null,
      description:
        "A Toronto-based AI challenge for builders exploring agents, tooling, and cloud workflows.",
      fingerprint: "mock-fp-hackto-ai",
      sourceIds: { mock: "hackto-ai" },
      approvedAt: null,
      rejectedAt: null,
      savedAt: null,
    },
    {
      status: "NEW",
      score: 78,
      name: "Waterloo Builders Hack",
      summary: "Student-friendly builder hackathon in Waterloo.",
      source: "mock",
      officialUrl: "https://uwaterloo.example.com/builders-hack",
      applyUrl: "https://uwaterloo.example.com/builders-hack/apply",
      socialUrl: null,
      startDate: "2026-09-20",
      endDate: "2026-09-22",
      deadline: "2026-09-01",
      location: "Waterloo, Canada",
      mode: "in-person",
      city: "Waterloo",
      country: "Canada",
      prize: "Sponsor prizes",
      themes: ["developer tools", "cloud"],
      eligibility: "Students only",
      whyMatch: ["Near Waterloo", "Builder-focused"],
      redFlags: [],
      foundAt: now,
      lastVerified: now,
      sheetRowId: null,
      sheetAppendedAt: null,
      description: "Campus builders weekend with sponsor tracks and mentoring.",
      fingerprint: "mock-fp-waterloo-builders",
      sourceIds: { mock: "waterloo-builders" },
      approvedAt: null,
      rejectedAt: null,
      savedAt: null,
    },
    {
      status: "NEW",
      score: 81,
      name: "Remote Agent Hack",
      summary: "Global online hackathon for AI agents and cloud workflows.",
      source: "mock",
      officialUrl: "https://remoteagents.example.com/hack",
      applyUrl: "https://remoteagents.example.com/hack/apply",
      socialUrl: null,
      startDate: "2026-08-05",
      endDate: "2026-08-07",
      deadline: "2026-07-30",
      location: "Online",
      mode: "online",
      city: "Remote",
      country: "Online",
      prize: "$7,500",
      themes: ["agents", "cloud", "AI"],
      eligibility: "Open worldwide",
      whyMatch: ["Remote-friendly", "Agent theme"],
      redFlags: [],
      foundAt: now,
      lastVerified: now,
      sheetRowId: null,
      sheetAppendedAt: null,
      description: "Fully remote agent hack with async demos and mentor office hours.",
      fingerprint: "mock-fp-remote-agent",
      sourceIds: { mock: "remote-agent" },
      approvedAt: null,
      rejectedAt: null,
      savedAt: null,
    },
    {
      status: "NEEDS_REVIEW",
      score: 58,
      name: "Sparse Details Summit",
      summary: null,
      source: "mock",
      officialUrl: null,
      applyUrl: null,
      socialUrl: "https://x.example.com/sparse",
      startDate: null,
      endDate: null,
      deadline: null,
      location: null,
      mode: "unknown",
      city: null,
      country: null,
      prize: null,
      themes: [],
      eligibility: null,
      whyMatch: [],
      redFlags: ["Needs official link", "Missing dates"],
      foundAt: now,
      lastVerified: now,
      sheetRowId: null,
      sheetAppendedAt: null,
      description: null,
      fingerprint: "mock-fp-sparse",
      sourceIds: { mock: "sparse" },
      approvedAt: null,
      rejectedAt: null,
      savedAt: null,
    },
    {
      status: "APPROVED",
      score: 90,
      name: "Already Approved Demo",
      summary: "Fixture for approved history.",
      source: "hacklist",
      officialUrl: "https://approved.example.com",
      applyUrl: "https://approved.example.com/apply",
      socialUrl: null,
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      deadline: "2026-09-15",
      location: "Toronto, Canada",
      mode: "hybrid",
      city: "Toronto",
      country: "Canada",
      prize: "$5,000",
      themes: ["AI"],
      eligibility: "Open",
      whyMatch: ["Strong fit"],
      redFlags: [],
      foundAt: now,
      lastVerified: now,
      sheetRowId: null,
      sheetAppendedAt: null,
      description: "Already approved fixture used for history screens.",
      fingerprint: "mock-fp-approved",
      sourceIds: { mock: "approved" },
      approvedAt: now,
      rejectedAt: null,
      savedAt: null,
    },
  ];

  return seeds.map((seed, index) => {
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`;
    return {
      ...seed,
      id,
      evidence: seed.officialUrl
        ? [
            {
              id: randomUUID(),
              candidateId: id,
              type: "source_card" as const,
              url: seed.officialUrl,
              title: seed.name,
              snippet: seed.summary,
              raw: {},
              foundAt: now,
            },
          ]
        : [],
      answers: [],
      actions: [],
    };
  });
}

function getStore(): Map<string, MockRecord> {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Map<string, MockRecord>;
  };
  if (!globalStore[GLOBAL_KEY]) {
    globalStore[GLOBAL_KEY] = new Map(
      seedCandidates().map((candidate) => [candidate.id, candidate]),
    );
  }
  return globalStore[GLOBAL_KEY]!;
}

function toCard(record: MockRecord): CandidateCard {
  return {
    id: record.id,
    status: record.status,
    score: record.score,
    name: record.name,
    summary: record.summary,
    source: record.source,
    officialUrl: record.officialUrl,
    applyUrl: record.applyUrl,
    socialUrl: record.socialUrl,
    startDate: record.startDate,
    endDate: record.endDate,
    deadline: record.deadline,
    location: record.location,
    mode: record.mode,
    city: record.city,
    country: record.country,
    prize: record.prize,
    themes: record.themes,
    eligibility: record.eligibility,
    whyMatch: record.whyMatch,
    redFlags: record.redFlags,
    foundAt: record.foundAt,
    lastVerified: record.lastVerified,
    approvedAt: record.approvedAt,
    sheetRowId: record.sheetRowId,
    sheetAppendedAt: record.sheetAppendedAt,
  };
}

function sortRecords(
  records: MockRecord[],
  sort: ListCandidatesParams["sort"],
): MockRecord[] {
  const copy = [...records];
  if (sort === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  } else if (sort === "found_at") {
    copy.sort(
      (a, b) =>
        b.foundAt.localeCompare(a.foundAt) || b.id.localeCompare(a.id),
    );
  } else {
    copy.sort(
      (a, b) =>
        b.score - a.score ||
        b.foundAt.localeCompare(a.foundAt) ||
        b.id.localeCompare(a.id),
    );
  }
  return copy;
}

export function createMockCandidateRepository(): CandidateRepository {
  return {
    async listCandidates(params: ListCandidatesParams = {}): Promise<ListCandidatesResult> {
      const store = getStore();
      let records = [...store.values()];
      if (params.status) {
        records = records.filter((item) => item.status === params.status);
      }
      if (params.source) {
        records = records.filter((item) => item.source === params.source);
      }
      if (params.q) {
        const needle = params.q.toLowerCase();
        records = records.filter((item) => item.name.toLowerCase().includes(needle));
      }
      records = sortRecords(records, params.sort ?? "score");
      const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
      const offset = params.offset ?? 0;
      const page = records.slice(offset, offset + limit);
      return {
        candidates: page.map(toCard),
        total: records.length,
        nextCursor: undefined,
      };
    },

    async listPendingSheetSync(limit = 50): Promise<CandidateCard[]> {
      const capped = Math.min(Math.max(limit, 1), 200);
      const records = sortRecords(
        [...getStore().values()].filter(
          (item) =>
            item.status === "APPROVED" &&
            (!item.sheetRowId || !item.sheetAppendedAt),
        ),
        "found_at",
      );
      return records.slice(0, capped).map(toCard);
    },

    async getCandidate(id: string) {
      const record = getStore().get(id);
      if (!record) return null;
      return {
        ...toCard(record),
        description: record.description,
        fingerprint: record.fingerprint,
        sourceIds: record.sourceIds,
        evidence: record.evidence,
        answers: record.answers,
        actions: record.actions,
      };
    },

    async updateCandidateStatus(
      id: string,
      status: CandidateStatus,
      metadata: StatusChangeMetadata = {},
    ) {
      const store = getStore();
      const existing = store.get(id);
      if (!existing) {
        throw new Error(`Candidate not found: ${id}`);
      }
      if (existing.status === status) {
        return toCard(existing);
      }

      const now = new Date().toISOString();
      const actionMap: Partial<Record<CandidateStatus, CandidateAction["action"]>> = {
        APPROVED: "APPROVE",
        REJECTED: "REJECT",
        SAVED_FOR_LATER: "SAVE_FOR_LATER",
        NEW: "RESTORE",
      };
      const actionType = actionMap[status];
      const action: CandidateAction | null = actionType
        ? {
            id: randomUUID(),
            candidateId: id,
            action: actionType,
            previousStatus: existing.status,
            newStatus: status,
            reason: metadata.reason ?? null,
            metadata: metadata.metadata ?? {},
            createdAt: now,
          }
        : null;

      const updated: MockRecord = {
        ...existing,
        status,
        // Sheet metadata is cleared by reconcileCandidateSheetState, not here.
        approvedAt: status === "APPROVED" ? now : status === "NEW" ? null : existing.approvedAt,
        rejectedAt: status === "REJECTED" ? now : status === "NEW" ? null : existing.rejectedAt,
        savedAt:
          status === "SAVED_FOR_LATER" ? now : status === "NEW" ? null : existing.savedAt,
        actions: action ? [action, ...existing.actions] : existing.actions,
      };
      store.set(id, updated);
      return toCard(updated);
    },

    async updateSheetMetadata(
      id: string,
      meta: { sheetRowId: string; sheetAppendedAt?: string },
    ) {
      const store = getStore();
      const existing = store.get(id);
      if (!existing) {
        throw new Error(`Candidate not found: ${id}`);
      }
      const updated: MockRecord = {
        ...existing,
        sheetRowId: meta.sheetRowId,
        sheetAppendedAt: meta.sheetAppendedAt ?? new Date().toISOString(),
      };
      store.set(id, updated);
      return toCard(updated);
    },

    async clearSheetMetadata(id: string) {
      const store = getStore();
      const existing = store.get(id);
      if (!existing) {
        throw new Error(`Candidate not found: ${id}`);
      }
      const updated: MockRecord = {
        ...existing,
        sheetRowId: null,
        sheetAppendedAt: null,
      };
      store.set(id, updated);
      return toCard(updated);
    },

    async addAction(candidateId: string, action: AddActionInput) {
      const store = getStore();
      const existing = store.get(candidateId);
      if (!existing) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      const record: CandidateAction = {
        id: randomUUID(),
        candidateId,
        action: action.action,
        previousStatus: action.previousStatus ?? null,
        newStatus: action.newStatus ?? null,
        reason: action.reason ?? null,
        metadata: action.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
      store.set(candidateId, {
        ...existing,
        actions: [record, ...existing.actions],
      });
      return record;
    },

    async addCandidateAnswer(candidateId: string, answer: AddCandidateAnswerInput) {
      const store = getStore();
      const existing = store.get(candidateId);
      if (!existing) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      const record = {
        id: randomUUID(),
        question: answer.question,
        answer: answer.answer,
        confidence: answer.confidence ?? null,
        sources: answer.sources ?? [],
        createdAt: new Date().toISOString(),
      };
      store.set(candidateId, {
        ...existing,
        answers: [record, ...existing.answers],
      });
      return record;
    },
  };
}

export function resetMockCandidateStoreForTests(): void {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Map<string, MockRecord>;
  };
  delete globalStore[GLOBAL_KEY];
}

export function resetMockCandidateStore(): void {
  resetMockCandidateStoreForTests();
}
