import { createHash } from "node:crypto";
import type { GenericShadowLead } from "@/experiments/scraper-v2/generic/types";
import { cleanText, stableDedupeKey } from "@/experiments/scraper-v2/generic/valueUtils";

export type EventIdentityMethod = "url" | "structured_id" | "composite";

export type EventIdentity = {
  key: string;
  method: EventIdentityMethod;
  confidence: number;
};

function hashIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function identityForLead(lead: GenericShadowLead): EventIdentity | undefined {
  if (lead.canonicalUrl) {
    return { key: `url:${lead.canonicalUrl.toLowerCase()}`, method: "url", confidence: 1 };
  }
  if (lead.sourceRecordId) {
    return { key: `id:${lead.sourceRecordId.toLowerCase()}`, method: "structured_id", confidence: 0.9 };
  }
  const title = cleanText(lead.title);
  const composite = stableDedupeKey([title, lead.startDate ?? lead.deadline, lead.location]);
  if (!title || composite.length < 8) return undefined;
  return { key: `composite:${hashIdentity(composite)}`, method: "composite", confidence: 0.62 };
}

export function dedupeLeadsByIdentity(leads: GenericShadowLead[]): {
  leads: GenericShadowLead[];
  duplicatesRemoved: number;
  identityMethods: Record<EventIdentityMethod, number>;
} {
  const seen = new Set<string>();
  const out: GenericShadowLead[] = [];
  const identityMethods: Record<EventIdentityMethod, number> = {
    url: 0,
    structured_id: 0,
    composite: 0,
  };
  for (const lead of leads) {
    const identity = identityForLead(lead);
    const key = identity?.key ?? stableDedupeKey([lead.sourceRecordId, lead.canonicalUrl, lead.title, lead.startDate]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (identity) identityMethods[identity.method] += 1;
    out.push({
      ...lead,
      confidence: Math.min(lead.confidence, identity?.confidence ?? lead.confidence),
    });
  }
  return {
    leads: out,
    duplicatesRemoved: leads.length - out.length,
    identityMethods,
  };
}
