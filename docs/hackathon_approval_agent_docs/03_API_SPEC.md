# API Spec — Hackathon Approval Agent

## 1. API Principles

- The UI should not directly write to Google Sheets.
- Server routes handle approval, rejection, enrichment, and sheet append.
- Candidate state lives in Supabase.
- Discovery can run from CLI first; `/api/run-agent` is optional later.
- All request/response payloads should be validated with Zod.

## 2. CLI Commands

### 2.1 Run Discovery

```bash
npm run agent -- "find upcoming hackathons"
npm run agent -- "/find hackathons in Toronto"
npm run agent -- "search hackathons in Toronto from 2026-07-01 to 2026-08-31"
npm run agent -- "find AI agent hackathons remote or near Waterloo"
```

### 2.2 Process Manual Leads

```bash
npm run agent -- "process manual leads"
```

### 2.3 Dry Run

```bash
npm run agent -- "find upcoming hackathons" -- --dry-run
```

Expected CLI summary:

```text
Agent run complete
Raw leads: 84
Parsed events: 37
Duplicates updated: 11
New candidates: 14
Rejected: 12
Needs review: 3
Duration: 42.1s
```

## 3. Frontend Routes

### 3.1 `/queue`

Mobile-first swipe queue for `NEW` and `NEEDS_REVIEW` candidates.

### 3.2 `/candidate/[id]`

Detailed candidate view with evidence, actions, and follow-up Q&A.

### 3.3 `/approved`

Approved candidates and Google Sheet link.

### 3.4 `/rejected`

Rejected candidates. User can restore/save/approve later.

### 3.5 `/saved`

Saved-for-later candidates.

### 3.6 `/settings`

Sheet URL, source toggles, default preferences, and API status.

## 4. API Routes

## 4.1 Get Candidates

```http
GET /api/candidates?status=NEW&limit=10
```

Query params:

```ts
type GetCandidatesQuery = {
  status?: "NEW" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "SAVED_FOR_LATER" | "EXPIRED";
  limit?: number;
  cursor?: string;
};
```

Response:

```ts
type GetCandidatesResponse = {
  candidates: CandidateCard[];
  nextCursor?: string;
};
```

Candidate card:

```ts
type CandidateCard = {
  id: string;
  status: string;
  score: number;
  name: string;
  summary: string | null;
  source: string;
  officialUrl: string | null;
  applyUrl: string | null;
  socialUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  deadline: string | null;
  location: string | null;
  mode: "online" | "in-person" | "hybrid" | "unknown" | null;
  city: string | null;
  country: string | null;
  prize: string | null;
  themes: string[];
  eligibility: string | null;
  whyMatch: string[];
  redFlags: string[];
  foundAt: string;
  lastVerified: string;
};
```

## 4.2 Get Candidate Detail

```http
GET /api/candidates/:id
```

Response:

```ts
type CandidateDetailResponse = {
  candidate: CandidateCard & {
    description: string | null;
    fingerprint: string;
    sourceIds: Record<string, unknown>;
    evidence: CandidateEvidence[];
    answers: CandidateAnswer[];
    actions: CandidateAction[];
  };
};
```

## 4.3 Candidate Decision

```http
POST /api/candidates/:id/decision
```

Request:

```ts
type CandidateDecisionRequest = {
  action: "approve" | "reject" | "save_for_later" | "restore";
  reason?: string;
};
```

Response:

```ts
type CandidateDecisionResponse = {
  ok: true;
  candidateId: string;
  newStatus: string;
  sheetAppended?: boolean;
  sheetRowId?: string;
};
```

Behavior:

- `approve`: set status to `APPROVED`, append to Google Sheets, save sheet metadata.
- `reject`: set status to `REJECTED`, do not delete.
- `save_for_later`: set status to `SAVED_FOR_LATER`.
- `restore`: set status to `NEW`.

## 4.4 Enrich Candidate

```http
POST /api/candidates/:id/enrich
```

Request:

```ts
type EnrichCandidateRequest = {
  question: string;
};
```

Example:

```json
{
  "question": "What is the application deadline and is this open to students?"
}
```

Response:

```ts
type EnrichCandidateResponse = {
  ok: true;
  answer: string;
  updatedFields: Partial<CandidateCard>;
  evidenceAdded: CandidateEvidence[];
};
```

## 4.5 Undo Last Action

```http
POST /api/actions/:id/undo
```

Response:

```ts
type UndoActionResponse = {
  ok: true;
  candidateId: string;
  restoredStatus: string;
};
```

Note: Undoing an already-appended Google Sheets row should not delete the sheet row in MVP. Instead, the app can mark the candidate as changed and show a warning. Later version may update the sheet row if row IDs are tracked.

## 4.6 Manual Lead Create

```http
POST /api/manual-leads
```

Request:

```ts
type CreateManualLeadRequest = {
  platform: "X" | "Instagram" | "LinkedIn" | "Discord" | "Website" | "Other";
  url: string;
  notes?: string;
};
```

Response:

```ts
type CreateManualLeadResponse = {
  ok: true;
  leadId: string;
};
```

## 4.7 Run Agent Later

Optional post-MVP route:

```http
POST /api/run-agent
```

Request:

```ts
type RunAgentRequest = {
  command: string;
  dryRun?: boolean;
};
```

Response:

```ts
type RunAgentResponse = {
  ok: true;
  runId: string;
  status: "queued" | "started";
};
```

MVP note: this can be omitted initially. Prefer local CLI for discovery.

## 5. Internal Tool Interfaces

## 5.1 Collector Interface

```ts
export type DiscoveryPreferences = {
  rawCommand: string;
  locations: string[];
  themes: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
  modes: Array<"online" | "in-person" | "hybrid">;
  includeSources: string[];
  excludePast: boolean;
};

export type RawLead = {
  source: string;
  sourceUrl?: string;
  title?: string;
  text?: string;
  links: string[];
  sourceId?: string;
  discoveredAt: string;
};

export interface Collector {
  name: string;
  collect(preferences: DiscoveryPreferences): Promise<RawLead[]>;
}
```

## 5.2 Candidate Event Type

```ts
export type HackathonEvent = {
  name: string;
  source: string;
  officialUrl?: string;
  applyUrl?: string;
  socialUrl?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  location?: string;
  mode?: "online" | "in-person" | "hybrid" | "unknown";
  city?: string;
  country?: string;
  prize?: string;
  themes: string[];
  eligibility?: string;
  description?: string;
};
```

## 5.3 Scoring Result

```ts
export type ScoringResult = {
  score: number;
  whyMatch: string[];
  redFlags: string[];
  rejectionReason?: string;
};
```

## 5.4 Evidence Type

```ts
export type CandidateEvidence = {
  id: string;
  candidateId: string;
  type: "official_page" | "apply_page" | "x_post" | "manual_lead" | "search_result" | "source_card";
  url?: string;
  title?: string;
  snippet?: string;
  raw?: unknown;
  foundAt: string;
};
```

## 6. Google Sheets Append Contract

Append only approved candidates to the `Hackathons` tab.

Columns:

```text
Status
Score
Name
Source
Official URL
Apply URL
Social URL
Start Date
End Date
Deadline
Location
Mode
City
Country
Prize
Themes
Eligibility
Why Match
Red Flags
Found At
Last Verified
```

Append row payload:

```ts
type SheetRow = [
  status: string,
  score: number,
  name: string,
  source: string,
  officialUrl: string,
  applyUrl: string,
  socialUrl: string,
  startDate: string,
  endDate: string,
  deadline: string,
  location: string,
  mode: string,
  city: string,
  country: string,
  prize: string,
  themes: string,
  eligibility: string,
  whyMatch: string,
  redFlags: string,
  foundAt: string,
  lastVerified: string
];
```
