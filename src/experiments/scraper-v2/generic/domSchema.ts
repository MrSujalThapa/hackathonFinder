import type {
  DomExtractionSchema,
  DomNodeSummary,
  DomRepresentation,
  GenericShadowLead,
  RepeatedUnitSet,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";
import { parseDateish, stableDedupeKey } from "@/experiments/scraper-v2/generic/valueUtils";

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

function candidateTitle(nodes: DomNodeSummary[]): string | undefined {
  const candidates = nodes
    .flatMap((node) => [node.headingText, node.textSample])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 4 && value.length <= 160)
    .filter((value) => !/^(open|past|upcoming|all|home|about|sponsors?|organizers?|faq|login|sign in|listitem)$/i.test(value))
    .filter((value) => !/^https?:\/\//i.test(value));
  return candidates[0];
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

function candidateDate(nodes: DomNodeSummary[]): string | undefined {
  for (const sample of nodes.flatMap((node) => [node.textSample, node.headingText])) {
    const parsed = parseDateish(sample);
    if (parsed) return parsed;
  }
  return undefined;
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
    const title = candidateTitle(nodes);
    if (!title) continue;
    const href = candidateHref(nodes, input.experiment);
    const date = candidateDate(nodes);
    const location = candidateLocation(nodes);
    const mode = candidateMode(nodes);
    const key = stableDedupeKey([href, title, date]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    leads.push({
      sourceUrl: input.experiment.inputUrl,
      artifactKind: "dom_snapshot",
      title,
      ...(href ? { canonicalUrl: href, sourceRecordId: href } : {}),
      ...(date ? { startDate: date } : {}),
      ...(location ? { location } : {}),
      ...(mode ? { mode } : {}),
      normalizedStatus: "unknown",
      statusInference: "dom repeated-unit inference",
      confidence: Math.min(1, Number((input.unitSet.confidence + (href ? 0.1 : 0) + (date ? 0.05 : 0)).toFixed(3))),
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
