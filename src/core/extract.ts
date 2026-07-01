import type {
  DiscoveryMode,
  HackathonEvent,
  HackathonEvidence,
  RawLead,
} from "@/core/discovery/types";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asMode(value: unknown): DiscoveryMode | undefined {
  const mode = asString(value);
  if (mode === "online" || mode === "in-person" || mode === "hybrid" || mode === "unknown") {
    return mode;
  }
  return undefined;
}

function buildEvidence(lead: RawLead, event: Partial<HackathonEvent>): HackathonEvidence[] {
  const evidence: HackathonEvidence[] = [];

  if (event.officialUrl) {
    evidence.push({
      type: "official_page",
      url: event.officialUrl,
      title: lead.title,
      snippet: lead.text,
      raw: { leadId: lead.id },
    });
  }

  if (event.applyUrl) {
    evidence.push({
      type: "apply_page",
      url: event.applyUrl,
      title: `${lead.title ?? event.name} apply`,
      raw: { leadId: lead.id },
    });
  }

  if (event.socialUrl) {
    evidence.push({
      type: "x_post",
      url: event.socialUrl,
      title: lead.title,
      snippet: lead.text,
      raw: { leadId: lead.id },
    });
  }

  if (evidence.length === 0 && lead.url) {
    evidence.push({
      type: "source_card",
      url: lead.url,
      title: lead.title,
      snippet: lead.text,
      raw: { leadId: lead.id, metadata: lead.metadata ?? {} },
    });
  }

  return evidence;
}

function isSocialUrl(url?: string): boolean {
  return Boolean(url && /x\.com|twitter\.com/i.test(url));
}

export function extractHackathonEvent(lead: RawLead): HackathonEvent | null {
  const metadata = lead.metadata ?? {};
  const name = asString(metadata.name) ?? lead.title?.trim();
  if (!name) {
    return null;
  }

  const officialFromMetadata = asString(metadata.officialUrl);
  const officialFromLinks = lead.links.find(
    (link) => /official|event|hack/i.test(link) && !isSocialUrl(link),
  );
  const officialUrl =
    officialFromMetadata ??
    officialFromLinks ??
    (lead.url && !isSocialUrl(lead.url) ? lead.url : undefined);
  const applyUrl =
    asString(metadata.applyUrl) ??
    lead.links.find((link) => /apply|register/i.test(link));
  const socialUrl =
    asString(metadata.socialUrl) ??
    (isSocialUrl(lead.url) ? lead.url : undefined) ??
    lead.links.find((link) => isSocialUrl(link));

  const themes = Array.isArray(metadata.themes)
    ? metadata.themes.filter((value): value is string => typeof value === "string")
    : [];

  const event: HackathonEvent = {
    name,
    source: lead.source,
    officialUrl,
    applyUrl,
    socialUrl,
    startDate: asString(metadata.startDate),
    endDate: asString(metadata.endDate),
    deadline: asString(metadata.deadline),
    location: asString(metadata.location) ?? asString(metadata.city),
    mode: asMode(metadata.mode),
    city: asString(metadata.city),
    country: asString(metadata.country),
    prize: asString(metadata.prize),
    themes,
    eligibility: asString(metadata.eligibility),
    description: lead.text,
    sourceIds:
      metadata.sourceIds && typeof metadata.sourceIds === "object"
        ? (metadata.sourceIds as Record<string, unknown>)
        : { [lead.source]: lead.id },
    evidence: [],
  };

  event.evidence = buildEvidence(lead, event);
  return event;
}

export function extractHackathonEvents(leads: RawLead[]): HackathonEvent[] {
  const events: HackathonEvent[] = [];

  for (const lead of leads) {
    try {
      const event = extractHackathonEvent(lead);
      if (event) {
        events.push(event);
      }
    } catch {
      // Skip malformed leads without failing the run.
    }
  }

  return events;
}
