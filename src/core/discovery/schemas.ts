import { z } from "zod";

export const discoveryModeSchema = z.enum([
  "online",
  "in-person",
  "hybrid",
  "unknown",
]);

export const reviewPolicySchema = z.enum(["broad", "balanced", "strict"]);
export const discoveryProfileSchema = z.enum(["light", "standard", "deep", "exhaustive"]);
export const locationConstraintSchema = z.enum(["event_location", "participant_eligibility", "none"]);
export const remotePolicySchema = z.enum(["exclude", "include", "only", "inferred_open"]);
export const parsedDateEvidenceSchema = z.object({
  value: z.string().nullable(),
  kind: z.enum([
    "event_start",
    "event_end",
    "registration_open",
    "registration_deadline",
    "application_deadline",
    "submission_open",
    "submission_deadline",
    "judging_start",
    "judging_end",
    "result_announcement",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  sourceUrl: z.string(),
  sourceText: z.string().optional(),
  retrievedAt: z.string().optional(),
  sourceType: z.enum(["listing", "detail", "schedule", "api", "text"]).optional(),
});
export const eventLocationSchema = z.object({
  mode: z.enum(["in_person", "remote", "hybrid", "unknown"]),
  venue: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  rawText: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]),
});

export const sourceNameSchema = z.enum([
  "hacklist",
  "hakku",
  "devpost",
  "mlh",
  "luma",
  "web",
  "x",
  "mock",
]);

export const rawLeadSchema = z.object({
  id: z.string().min(1),
  source: sourceNameSchema,
  title: z.string().optional(),
  url: z.string().url().optional(),
  text: z.string().optional(),
  links: z.array(z.string()),
  postedAt: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const hackathonEvidenceSchema = z.object({
  type: z.enum([
    "official_page",
    "apply_page",
    "x_post",
    "manual_lead",
    "search_result",
    "source_card",
  ]),
  url: z.string().optional(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  raw: z.record(z.unknown()).optional(),
});

export const hackathonEventSchema = z.object({
  name: z.string().min(1),
  source: sourceNameSchema,
  officialUrl: z.string().url().optional(),
  applyUrl: z.string().url().optional(),
  socialUrl: z.string().url().optional(),
  eventStartDate: z.string().optional(),
  eventEndDate: z.string().optional(),
  registrationOpenDate: z.string().optional(),
  registrationDeadline: z.string().optional(),
  applicationDeadline: z.string().optional(),
  submissionOpenDate: z.string().optional(),
  submissionDeadline: z.string().optional(),
  judgingStartDate: z.string().optional(),
  judgingEndDate: z.string().optional(),
  resultAnnouncementDate: z.string().optional(),
  displayedDateRange: z.string().optional(),
  parsedDateEvidence: z.array(parsedDateEvidenceSchema).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  deadline: z.string().optional(),
  location: z.string().optional(),
  mode: discoveryModeSchema.optional(),
  eventLocation: eventLocationSchema.optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  prize: z.string().optional(),
  themes: z.array(z.string()),
  eligibility: z.string().optional(),
  description: z.string().optional(),
  sourceIds: z.record(z.unknown()).optional(),
  evidence: z.array(hackathonEvidenceSchema),
});

export const discoveryPreferencesSchema = z.object({
  rawCommand: z.string().min(1),
  locations: z.array(z.string()),
  locationConstraint: locationConstraintSchema.optional(),
  remotePolicy: remotePolicySchema.optional(),
  onsiteOnly: z.boolean().optional(),
  profile: discoveryProfileSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  themes: z.array(z.string()),
  modes: z.array(discoveryModeSchema),
  sources: z.array(sourceNameSchema),
  includeRemote: z.boolean(),
  includeInPerson: z.boolean(),
  maxResults: z.number().int().positive(),
  reviewPolicy: reviewPolicySchema.optional(),
});

export const scoringResultSchema = z.object({
  score: z.number(),
  whyMatch: z.array(z.string()),
  redFlags: z.array(z.string()),
  rejected: z.boolean(),
  rejectionReason: z.string().optional(),
});

export const verificationResultSchema = z.object({
  valid: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  status: z.enum(["accepted", "rejected", "needs_review"]),
  reasons: z.array(z.string()),
  redFlags: z.array(z.string()),
});

export const rejectedCandidateSchema = z.object({
  name: z.string(),
  source: sourceNameSchema,
  stage: z.enum(["verification", "scoring"]),
  reason: z.string(),
});

export const agentRunSummarySchema = z.object({
  rawCommand: z.string(),
  preferences: discoveryPreferencesSchema,
  dryRun: z.boolean(),
  rawLeads: z.number().int().nonnegative(),
  extracted: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  stored: z.number().int().nonnegative(),
  duplicatesUpdated: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  acceptedCandidates: z.array(
    z.object({
      name: z.string(),
      score: z.number(),
      location: z.string(),
      deadline: z.string(),
      status: z.string(),
    }),
  ),
  rejectedCandidates: z.array(rejectedCandidateSchema),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});
