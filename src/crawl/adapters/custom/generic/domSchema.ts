import type {
  DomExtractionSchema,
  DomNodeSummary,
  DomRepresentation,
  GenericShadowLead,
  RepeatedUnitSet,
  SourceExperiment,
} from "@/crawl/adapters/custom/generic/types";
import { parseDateish, stableDedupeKey } from "@/crawl/adapters/custom/generic/valueUtils";

function ratio(count: number, total: number): number {
  return total <= 0 ? 0 : Number((count / total).toFixed(3));
}

function nodeMap(representation: DomRepresentation): Map<number, DomNodeSummary> {
  return new Map(representation.nodes.map((node) => [node.nodeId, node]));
}

function descendants(unit: DomNodeSummary, map: Map<number, DomNodeSummary>): DomNodeSummary[] {
  const out = [unit];
  const queue = [...unit.childIds];
  while (queue.length > 0 && out.length < 80) {
    const id = queue.shift();
    if (!id) continue;
    const node = map.get(id);
    if (!node) continue;
    out.push(node);
    queue.push(...node.childIds);
  }
  return out;
}

/** Field/meta labels that must not be treated as event titles. */
const META_LABEL_TITLE =
  /^(registration\s+(start|end|opens?|closes?)|starts?|ends?|deadline|status|mode|format|location|venue|prize|eligibility|team size|apply by|applications?\s+close|submissions?\s+close)\s*:/i;
const STATUS_BADGE_TITLE =
  /^(registration\s+(closed|open|opens|closes|ended|live)|closed|open|upcoming|past|active|ended|sold out|applications?\s+(closed|open))$/i;
const EVENT_TITLE_HINT =
  /\b(hackathon|hack|challenge|competition|summit|conference|build|jam|sprint|meetup|workshop|bounty|cup|fest)\b/i;

function isMetaLabelTitle(value: string): boolean {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (META_LABEL_TITLE.test(trimmed)) return true;
  if (STATUS_BADGE_TITLE.test(trimmed)) return true;
  // Entire title is a registration/date label with an embedded date.
  if (/^registration\s+(start|end|opens?|closes?)\b/i.test(trimmed)) return true;
  // Status/meta chrome blobs with trailing date lines and no event vocabulary.
  if (
    /^registration\s+(closed|open|start|end|opens?|closes?)\b/i.test(trimmed) &&
    !EVENT_TITLE_HINT.test(trimmed)
  ) {
    return true;
  }
  if (/^(starts?|ends?|deadline)\b.{0,40}\d{4}/i.test(trimmed) && !EVENT_TITLE_HINT.test(trimmed)) {
    return true;
  }
  return false;
}

/** Prefer a humanized path slug when DOM text is only status/meta chrome. */
function titleFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const path = new URL(href).pathname.replace(/\/+$/, "");
    const slug = path.split("/").filter(Boolean).pop();
    if (!slug || slug.length < 3) return undefined;
    if (/^(hack|hacks|event|events|allhacks|index)$/i.test(slug)) return undefined;
    const humanized = slug
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (humanized.length < 4 || isMetaLabelTitle(humanized)) return undefined;
    return humanized;
  } catch {
    return undefined;
  }
}

function titleQuality(value: string): number {
  let score = 0;
  if (EVENT_TITLE_HINT.test(value)) score += 3;
  if (/^[A-Z0-9]/.test(value)) score += 1;
  if (value.length >= 8 && value.length <= 100) score += 1;
  if (parseDateish(value) && !EVENT_TITLE_HINT.test(value)) score -= 2;
  if (isMetaLabelTitle(value)) score -= 5;
  return score;
}

function candidateTitle(nodes: DomNodeSummary[]): string | undefined {
  const candidates = nodes
    .flatMap((node) => [node.headingText, node.textSample])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s+/g, " ").trim())
    // Prefer the first line when a textSample concatenates badge + meta rows.
    .flatMap((value) => {
      const firstLine = value.split(/\s*[·|]\s*|\s{2,}/)[0]?.trim() ?? value;
      return firstLine === value ? [value] : [firstLine, value];
    })
    .filter((value) => value.length >= 4 && value.length <= 160)
    .filter((value) => !/^(open|past|upcoming|all|home|about|sponsors?|organizers?|faq|login|sign in|listitem|closed|online|virtual)$/i.test(value))
    .filter((value) => !/^https?:\/\//i.test(value))
    .filter((value) => !isMetaLabelTitle(value));
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((left, right) => titleQuality(right) - titleQuality(left))[0];
}

function candidateHref(nodes: DomNodeSummary[], experiment: SourceExperiment): string | undefined {
  for (const href of nodes.flatMap((node) => node.hrefs)) {
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    try {
      const resolved = new URL(href, experiment.inputUrl);
      if (!/^https?:$/i.test(resolved.protocol)) continue;
      const listing = new URL(experiment.inputUrl);
      if (
        resolved.origin === listing.origin &&
        resolved.pathname.replace(/\/$/, "") === listing.pathname.replace(/\/$/, "")
      ) {
        continue;
      }
      return resolved.toString();
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return undefined;
}

type LabeledDates = {
  eventStart?: string;
  deadline?: string;
  registrationStart?: string;
  registrationEnd?: string;
};

/**
 * Prefer event dates for startDate. Registration open/close maps to deadline
 * (registration end) and must not invent event start dates.
 */
function candidateLabeledDates(nodes: DomNodeSummary[]): LabeledDates {
  const out: LabeledDates = {};
  const samples = [
    ...nodes.flatMap((node) => [node.textSample, node.headingText]),
    // Full-card blob helps when labels and dates sit in sibling text nodes.
    nodes
      .map((node) => node.textSample ?? node.headingText ?? "")
      .filter(Boolean)
      .join(" · "),
  ];
  const cardBlob = samples
    .filter(Boolean)
    .map((sample) => String(sample).replace(/\s+/g, " ").trim())
    .join(" · ");
  const cardHasRegistrationLabel = /\bregistration\s+(start|end|opens?|closes?)\b/i.test(cardBlob);

  for (const sample of samples) {
    if (!sample) continue;
    const text = sample.replace(/\s+/g, " ").trim();
    // Match labeled dates even when label and ISO date are adjacent in a blob.
    const labeled = [
      ...text.matchAll(
        /(registration\s+(?:start|opens?)|registration\s+(?:end|closes?)|deadline|apply by|applications?\s+close|submissions?\s+close)\s*:?\s*([^·|;\n]+)/gi,
      ),
    ];
    for (const match of labeled) {
      const label = match[1] ?? "";
      const parsed = parseDateish(match[2] ?? "") ?? parseDateish(match[0] ?? "");
      if (!parsed) continue;
      if (/registration\s+(start|opens?)/i.test(label)) out.registrationStart ??= parsed;
      else if (/registration\s+(end|closes?)/i.test(label)) out.registrationEnd ??= parsed;
      else out.deadline ??= parsed;
    }
    const parsed = parseDateish(text);
    if (!parsed) continue;
    if (/registration\s+(start|opens?)\b/i.test(text)) {
      out.registrationStart ??= parsed;
      continue;
    }
    if (/registration\s+(end|closes?)\b/i.test(text)) {
      out.registrationEnd ??= parsed;
      continue;
    }
    if (/\b(deadline|apply by|application|submission)\b/i.test(text)) {
      out.deadline ??= parsed;
      continue;
    }
    // Bare date siblings inside a registration-labeled card are not event starts.
    if (cardHasRegistrationLabel) continue;
    if (!/registration/i.test(text)) {
      out.eventStart ??= parsed;
    }
  }
  if (!out.deadline && out.registrationEnd) out.deadline = out.registrationEnd;
  return out;
}

function candidateLocation(nodes: DomNodeSummary[]): string | undefined {
  for (const sample of nodes.map((node) => node.textSample).filter(Boolean) as string[]) {
    const match = sample.match(/\b(?:online|virtual|hybrid|remote|in-person|onsite|[A-Z][a-z]+,\s*[A-Z][a-z]+|[A-Z][a-z]+\s*,\s*[A-Z]{2})\b/);
    if (match) return match[0];
  }
  return undefined;
}

function candidateMode(nodes: DomNodeSummary[]): string | undefined {
  const blob = nodes.map((node) => node.textSample ?? "").join(" ");
  return blob.match(/\b(online|virtual|hybrid|remote|in-person|onsite)\b/i)?.[1];
}

function duplicateRate(leads: GenericShadowLead[]): number {
  const keys = leads.map((lead) => stableDedupeKey([lead.sourceRecordId, lead.canonicalUrl, lead.title, lead.startDate]));
  return ratio(keys.length - new Set(keys).size, keys.length);
}

export function inferDomSchemaAndLeads(input: {
  representation: DomRepresentation;
  unitSet: RepeatedUnitSet;
  experiment: SourceExperiment;
  allowCompositeIdentity?: boolean;
}): { schema?: DomExtractionSchema; leads: GenericShadowLead[]; rejectionReasons: string[] } {
  const map = nodeMap(input.representation);
  const parent = map.get(input.unitSet.parentNodeId);
  const units = input.unitSet.unitNodeIds.map((id) => map.get(id)).filter((node): node is DomNodeSummary => Boolean(node));
  if (!parent || units.length < 2) {
    return { leads: [], rejectionReasons: ["missing repeated unit nodes"] };
  }

  const leads: GenericShadowLead[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const nodes = descendants(unit, map);
    const href = candidateHref(nodes, input.experiment);
    const title = candidateTitle(nodes) ?? titleFromHref(href);
    if (!title) continue;
    const dates = candidateLabeledDates(nodes);
    const location = candidateLocation(nodes);
    const mode = candidateMode(nodes);
    const dateKey = dates.eventStart ?? dates.deadline ?? dates.registrationStart;
    const compositeIdentity =
      input.allowCompositeIdentity && !href ? stableDedupeKey([title, dateKey, location]) : undefined;
    const key = stableDedupeKey([href, compositeIdentity, title, dateKey]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const descriptionParts = [
      dates.registrationStart ? `Registration start: ${dates.registrationStart.slice(0, 10)}` : null,
      dates.registrationEnd ? `Registration end: ${dates.registrationEnd.slice(0, 10)}` : null,
    ].filter(Boolean);
    const cardBlob = nodes
      .map((node) => node.textSample ?? node.headingText ?? "")
      .join(" ");
    const registrationClosed = /\bregistration\s+closed\b/i.test(cardBlob);
    const registrationOpen = /\bregistration\s+open\b/i.test(cardBlob);
    leads.push({
      sourceUrl: input.experiment.inputUrl,
      artifactKind: "dom_snapshot",
      title,
      ...(href ? { canonicalUrl: href, sourceRecordId: href } : {}),
      ...(!href && compositeIdentity ? { sourceRecordId: `composite:${compositeIdentity}` } : {}),
      // Honest: registration dates are not event start dates.
      ...(dates.eventStart ? { startDate: dates.eventStart } : {}),
      ...(dates.deadline ? { deadline: dates.deadline } : {}),
      ...(location ? { location } : {}),
      ...(mode ? { mode } : {}),
      ...(descriptionParts.length > 0 ? { description: descriptionParts.join(" · ") } : {}),
      normalizedStatus: registrationClosed ? "closed" : registrationOpen ? "open" : "unknown",
      statusInference: registrationClosed || registrationOpen
        ? "dom registration status badge"
        : "dom repeated-unit inference",
      confidence: Math.min(
        1,
        Number(
          (
            input.unitSet.confidence +
            (href ? 0.1 : 0) +
            (dates.eventStart || dates.deadline ? 0.05 : 0) -
            (!href && compositeIdentity ? 0.12 : 0)
          ).toFixed(3),
        ),
      ),
    });
  }

  const titleCompleteness = ratio(leads.filter((lead) => lead.title).length, units.length);
  const identityCompleteness = ratio(leads.filter((lead) => lead.canonicalUrl || lead.sourceRecordId).length, units.length);
  const duplicates = duplicateRate(leads);
  const rejectionReasons: string[] = [];
  if (titleCompleteness < 0.6) rejectionReasons.push("low title completeness");
  if (identityCompleteness < 0.5) rejectionReasons.push("low identity completeness");
  if (duplicates > 0.2) rejectionReasons.push("high duplicate rate");
  if (leads.length < 2) rejectionReasons.push("too few valid DOM records");

  const schema: DomExtractionSchema = {
    version: 1,
    pageFingerprint: `${input.representation.nodeCount}:${input.representation.maxDepth}`,
    recordContainer: {
      parentFingerprint: parent.structuralFingerprint,
      unitFingerprint: units[0]?.structuralFingerprint ?? "",
      unitTag: units[0]?.tag ?? "",
      unitClassShape: units[0]?.classShape ?? "",
    },
    fields: {
      title: {
        relation: "heading",
        confidence: titleCompleteness,
        evidence: ["unique title-like text within repeated unit"],
      },
      ...(identityCompleteness > 0
        ? {
            url: {
              relation: "anchor" as const,
              confidence: identityCompleteness,
              evidence: ["record-specific href within repeated unit"],
            },
          }
        : {}),
      ...(leads.some((lead) => lead.startDate)
        ? {
            startDate: {
              relation: "text" as const,
              confidence: ratio(leads.filter((lead) => lead.startDate).length, units.length),
              evidence: ["date-like text inside repeated unit"],
            },
          }
        : {}),
      ...(leads.some((lead) => lead.location)
        ? {
            location: {
              relation: "text" as const,
              confidence: ratio(leads.filter((lead) => lead.location).length, units.length),
              evidence: ["location-like text inside repeated unit"],
            },
          }
        : {}),
      ...(leads.some((lead) => lead.mode)
        ? {
            mode: {
              relation: "text" as const,
              confidence: ratio(leads.filter((lead) => lead.mode).length, units.length),
              evidence: ["mode-like text inside repeated unit"],
            },
          }
        : {}),
    },
    confidence: Math.max(0, Number((input.unitSet.confidence * 0.5 + titleCompleteness * 0.25 + identityCompleteness * 0.25 - duplicates * 0.2).toFixed(3))),
    validationMetrics: {
      testedRecords: units.length,
      validRecords: leads.length,
      titleCompleteness,
      identityCompleteness,
      duplicateRate: duplicates,
    },
  };

  return {
    schema: rejectionReasons.length === 0 ? schema : undefined,
    leads: rejectionReasons.length === 0 ? leads : [],
    rejectionReasons,
  };
}
