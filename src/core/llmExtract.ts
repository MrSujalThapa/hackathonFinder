import type {
  DiscoveryMode,
  HackathonEvent,
  HackathonEvidence,
  RawLead,
} from "@/core/discovery/types";
import { normalizeDatePart, normalizeText, normalizeUrl } from "@/core/dedupe";
import { extractHackathonEvent } from "@/core/extract";

export type StructuredEventField =
  | "name"
  | "officialUrl"
  | "applyUrl"
  | "socialUrl"
  | "startDate"
  | "endDate"
  | "deadline"
  | "location"
  | "mode"
  | "city"
  | "country"
  | "prize"
  | "themes"
  | "eligibility"
  | "description";

export type ExtractionEvidence = HackathonEvidence & {
  id?: string;
};

export type FieldCitation = {
  field: StructuredEventField;
  value: unknown;
  quote?: string;
  evidenceId?: string;
  url?: string;
  confidence?: "low" | "medium" | "high";
};

export type LlmExtractionOutput = {
  fields?: Partial<Record<StructuredEventField, unknown>>;
  citations?: FieldCitation[];
};

export type LlmExtractionPrompt = {
  text: string;
  evidence: ExtractionEvidence[];
  allowedFields: StructuredEventField[];
};

export type LlmExtractionProvider = {
  readonly name: string;
  extract(input: LlmExtractionPrompt): Promise<string | LlmExtractionOutput>;
};

export type GroundedField = FieldCitation & {
  value: string | string[];
};

export type GroundedExtractionInput = {
  lead?: RawLead;
  text?: string;
  evidence?: ExtractionEvidence[];
  provider?: LlmExtractionProvider;
  now?: Date;
};

export type GroundedExtractionResult = {
  event: Partial<HackathonEvent>;
  groundedFields: GroundedField[];
  unsupportedFields: FieldCitation[];
  warnings: string[];
  cacheKey: string;
  providerName: string;
};

export const STRUCTURED_EVENT_FIELDS: StructuredEventField[] = [
  "name",
  "officialUrl",
  "applyUrl",
  "socialUrl",
  "startDate",
  "endDate",
  "deadline",
  "location",
  "mode",
  "city",
  "country",
  "prize",
  "themes",
  "eligibility",
  "description",
];

const URL_FIELDS = new Set<StructuredEventField>([
  "officialUrl",
  "applyUrl",
  "socialUrl",
]);

const DATE_FIELDS = new Set<StructuredEventField>([
  "startDate",
  "endDate",
  "deadline",
]);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))];
}

function evidenceText(evidence: ExtractionEvidence[]): string {
  return evidence
    .map((item) =>
      [
        item.id,
        item.url,
        item.title,
        item.snippet,
        item.raw ? stableStringify(item.raw) : "",
      ].filter(Boolean).join(" "),
    )
    .join(" ");
}

function evidenceForLead(lead: RawLead): ExtractionEvidence[] {
  const raw = {
    leadId: lead.id,
    source: lead.source,
    metadata: lead.metadata ?? {},
    links: lead.links,
  };

  return [
    {
      id: lead.id,
      type: lead.source === "x" ? "x_post" : "source_card",
      url: lead.url,
      title: lead.title,
      snippet: lead.text,
      raw,
    },
  ];
}

function parseProviderOutput(raw: string | LlmExtractionOutput): LlmExtractionOutput {
  if (typeof raw !== "string") return raw;

  const trimmed = raw.trim();
  if (!trimmed) return {};
  const jsonFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = jsonFence?.[1] ?? trimmed;
  const parsed = JSON.parse(payload) as LlmExtractionOutput;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function normalizeFieldValue(
  field: StructuredEventField,
  value: unknown,
): string | string[] | undefined {
  if (field === "themes") {
    const themes = asStringArray(value);
    return themes.length > 0 ? themes : undefined;
  }

  const text = asString(value);
  if (!text) return undefined;

  if (DATE_FIELDS.has(field)) {
    return normalizeDatePart(text) ?? text;
  }

  if (URL_FIELDS.has(field)) {
    return normalizeUrl(text) ?? text;
  }

  if (field === "mode") {
    return normalizeMode(text);
  }

  return text;
}

function normalizeMode(value: string): DiscoveryMode | undefined {
  const normalized = normalizeText(value);
  if (normalized === "online" || normalized === "remote" || normalized === "virtual") {
    return "online";
  }
  if (normalized === "in person" || normalized === "onsite" || normalized === "on site") {
    return "in-person";
  }
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "unknown") return "unknown";
  return undefined;
}

function isEvidenceSupported(
  field: StructuredEventField,
  value: string | string[],
  citation: FieldCitation,
  evidence: ExtractionEvidence[],
): boolean {
  const haystack = compactWhitespace(evidenceText(evidence)).toLowerCase();
  const quote = asString(citation.quote);
  const compactQuote = quote ? compactWhitespace(quote).toLowerCase() : undefined;
  const quoteIsPresent = Boolean(compactQuote && haystack.includes(compactQuote));

  if (citation.evidenceId && evidence.some((item) => item.id === citation.evidenceId)) {
    if (quote) return false;
  }

  const values = Array.isArray(value) ? value : [value];
  if (URL_FIELDS.has(field)) {
    return values.some((entry) => {
      const normalized = normalizeUrl(entry);
      return evidence.some((item) =>
        normalizeUrl(item.url) === normalized ||
        normalizeUrl(asString(item.raw?.[field])) === normalized ||
        (item.snippet ?? "").includes(entry) ||
        Boolean(quoteIsPresent && compactQuote?.includes(entry.toLowerCase())),
      );
    });
  }

  return values.some((entry) => {
    const normalizedEntry = normalizeText(entry);
    if (!normalizedEntry) return false;
    if (DATE_FIELDS.has(field)) {
      return haystack.includes(entry.toLowerCase()) || haystack.includes(normalizedEntry);
    }
    const searchableText = quoteIsPresent && compactQuote ? compactQuote : haystack;
    return normalizedEntry
      .split(" ")
      .filter((token) => token.length > 2)
      .every((token) => searchableText.includes(token));
  });
}

function citationsFromFields(output: LlmExtractionOutput): FieldCitation[] {
  const explicit = output.citations ?? [];
  const implicit = Object.entries(output.fields ?? {}).map(([field, value]) => ({
    field: field as StructuredEventField,
    value,
  }));

  return [...explicit, ...implicit].filter((citation) =>
    STRUCTURED_EVENT_FIELDS.includes(citation.field),
  );
}

function applyGroundedField(
  event: Partial<HackathonEvent>,
  field: StructuredEventField,
  value: string | string[],
): void {
  if (field === "themes") {
    event.themes = [...new Set([...(event.themes ?? []), ...(Array.isArray(value) ? value : [value])])];
    return;
  }
  if (field === "mode") {
    event.mode = value as DiscoveryMode;
    return;
  }
  (event as Record<string, unknown>)[field] = Array.isArray(value) ? value.join(", ") : value;
}

function fallbackOutput(lead: RawLead | undefined, now: Date | undefined): LlmExtractionOutput {
  if (!lead) return {};
  const extracted = extractHackathonEvent(lead, { now });
  if (!extracted) return {};

  const fields: Partial<Record<StructuredEventField, unknown>> = {};
  for (const field of STRUCTURED_EVENT_FIELDS) {
    const value = extracted[field as keyof HackathonEvent];
    if (Array.isArray(value) ? value.length > 0 : Boolean(value)) {
      fields[field] = value;
    }
  }

  return { fields };
}

export function buildLlmExtractionCacheKey(input: {
  text?: string;
  evidence?: ExtractionEvidence[];
  lead?: Pick<RawLead, "id" | "source" | "title" | "url" | "text" | "links" | "metadata">;
  providerName?: string;
}): string {
  return `llm-extract:${hashText(stableStringify({
    providerName: input.providerName ?? "deterministic",
    text: input.text ?? "",
    evidence: input.evidence ?? [],
    lead: input.lead
      ? {
          id: input.lead.id,
          source: input.lead.source,
          title: input.lead.title,
          url: input.lead.url,
          text: input.lead.text,
          links: input.lead.links,
          metadata: input.lead.metadata,
        }
      : undefined,
  }))}`;
}

export async function extractGroundedHackathonEvent(
  input: GroundedExtractionInput,
): Promise<GroundedExtractionResult> {
  const evidence = input.evidence ?? (input.lead ? evidenceForLead(input.lead) : []);
  const text = input.text ?? [input.lead?.title, input.lead?.text].filter(Boolean).join("\n");
  const providerName = input.provider?.name ?? "deterministic";
  const warnings: string[] = [];
  let output: LlmExtractionOutput;

  if (input.provider) {
    try {
      output = parseProviderOutput(
        await input.provider.extract({
          text,
          evidence,
          allowedFields: STRUCTURED_EVENT_FIELDS,
        }),
      );
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Extraction provider failed");
      output = fallbackOutput(input.lead, input.now);
    }
  } else {
    output = fallbackOutput(input.lead, input.now);
  }

  const event: Partial<HackathonEvent> = input.lead
    ? {
        source: input.lead.source,
        evidence: input.lead ? (extractHackathonEvent(input.lead, { now: input.now })?.evidence ?? evidence) : evidence,
      }
    : { evidence };
  const groundedFields: GroundedField[] = [];
  const unsupportedFields: FieldCitation[] = [];

  for (const citation of citationsFromFields(output)) {
    const value = normalizeFieldValue(citation.field, citation.value);
    if (!value) continue;

    if (isEvidenceSupported(citation.field, value, citation, evidence)) {
      applyGroundedField(event, citation.field, value);
      groundedFields.push({ ...citation, value });
    } else {
      unsupportedFields.push(citation);
    }
  }

  if (!event.themes) event.themes = [];

  return {
    event,
    groundedFields,
    unsupportedFields,
    warnings,
    providerName,
    cacheKey: buildLlmExtractionCacheKey({
      text,
      evidence,
      lead: input.lead,
      providerName,
    }),
  };
}
