import type { DiscoveryPreferences, RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";

const MOCK_POSTED_AT = "2026-07-01T12:00:00Z";

const MOCK_LEADS: RawLead[] = [
  {
    id: "mock-hackto-ai",
    source: "mock",
    title: "HackTO AI Challenge",
    url: "https://hackto.example.com/ai-challenge",
    text: "Toronto AI hackathon focused on agents and cloud tooling.",
    links: [
      "https://hackto.example.com/ai-challenge",
      "https://hackto.example.com/ai-challenge/apply",
    ],
    postedAt: MOCK_POSTED_AT,
    metadata: {
      city: "Toronto",
      country: "Canada",
      mode: "in-person",
      themes: ["AI", "agents", "cloud"],
      deadline: "2026-08-15",
      startDate: "2026-09-13",
      endDate: "2026-09-15",
      prize: "$10,000 in prizes",
      eligibility: "Open to students and professionals in Canada",
      officialUrl: "https://hackto.example.com/ai-challenge",
      applyUrl: "https://hackto.example.com/ai-challenge/apply",
      sourceIds: { mock: "hackto-ai" },
    },
  },
  {
    id: "mock-waterloo-builders",
    source: "mock",
    title: "Waterloo Builders Hack",
    url: "https://uwaterloo.example.com/builders-hack",
    text: "Student-friendly builder hackathon in Waterloo.",
    links: [
      "https://uwaterloo.example.com/builders-hack",
      "https://uwaterloo.example.com/builders-hack/apply",
    ],
    postedAt: MOCK_POSTED_AT,
    metadata: {
      city: "Waterloo",
      country: "Canada",
      mode: "in-person",
      themes: ["developer tools", "cloud"],
      deadline: "2026-09-01",
      startDate: "2026-09-20",
      endDate: "2026-09-22",
      prize: "Sponsor prizes",
      eligibility: "Students only",
      officialUrl: "https://uwaterloo.example.com/builders-hack",
      applyUrl: "https://uwaterloo.example.com/builders-hack/apply",
      sourceIds: { mock: "waterloo-builders" },
    },
  },
  {
    id: "mock-remote-agent",
    source: "mock",
    title: "Remote Agent Hack",
    url: "https://remoteagents.example.com/hack",
    text: "Global online hackathon for AI agents and cloud workflows.",
    links: [
      "https://remoteagents.example.com/hack",
      "https://remoteagents.example.com/hack/apply",
    ],
    postedAt: MOCK_POSTED_AT,
    metadata: {
      city: "Remote",
      country: "Online",
      mode: "online",
      themes: ["agents", "cloud", "AI"],
      deadline: "2026-07-30",
      startDate: "2026-08-05",
      endDate: "2026-08-07",
      prize: "$7,500",
      eligibility: "Open worldwide",
      officialUrl: "https://remoteagents.example.com/hack",
      applyUrl: "https://remoteagents.example.com/hack/apply",
      sourceIds: { mock: "remote-agent" },
    },
  },
  {
    id: "mock-past-hack",
    source: "mock",
    title: "Past Hackathon",
    url: "https://past.example.com/hack",
    text: "This event already ended.",
    links: ["https://past.example.com/hack"],
    postedAt: MOCK_POSTED_AT,
    metadata: {
      city: "Toronto",
      country: "Canada",
      mode: "in-person",
      themes: ["AI"],
      deadline: "2024-05-01",
      startDate: "2024-05-10",
      endDate: "2024-05-12",
      officialUrl: "https://past.example.com/hack",
      applyUrl: "https://past.example.com/hack/apply",
    },
  },
  {
    id: "mock-social-vague",
    source: "mock",
    title: "Maybe a hackathon?",
    url: "https://x.com/hackleads/status/123",
    text: "Heard there might be a cool hackathon soon. DM for details.",
    links: ["https://x.com/hackleads/status/123"],
    postedAt: MOCK_POSTED_AT,
    metadata: {
      socialOnly: true,
      themes: ["AI"],
    },
  },
  {
    id: "mock-hackto-duplicate",
    source: "mock",
    title: "HackTO AI Challenge (duplicate listing)",
    url: "https://www.hackto.example.com/ai-challenge/?utm_source=mock",
    text: "Duplicate listing for HackTO with tracking params.",
    links: [
      "https://www.hackto.example.com/ai-challenge/?utm_source=mock",
      "https://hackto.example.com/ai-challenge/apply",
    ],
    postedAt: MOCK_POSTED_AT,
    metadata: {
      city: "Toronto",
      country: "Canada",
      mode: "in-person",
      themes: ["AI", "agents"],
      deadline: "2026-08-15",
      startDate: "2026-09-13",
      endDate: "2026-09-15",
      prize: "$10,000 in prizes",
      eligibility: "Open to students",
      officialUrl: "https://www.hackto.example.com/ai-challenge/?utm_source=mock",
      applyUrl: "https://hackto.example.com/ai-challenge/apply",
      sourceIds: { mock: "hackto-ai-dup" },
      duplicateOf: "mock-hackto-ai",
    },
  },
  {
    id: "mock-tokyo-robotics",
    source: "mock",
    title: "Random Robotics Fair",
    url: "https://tokyo-robotics.example.com/fair",
    text: "In-person robotics fair in Tokyo with a build sprint.",
    links: [
      "https://tokyo-robotics.example.com/fair",
      "https://tokyo-robotics.example.com/fair/register",
    ],
    postedAt: MOCK_POSTED_AT,
    metadata: {
      city: "Tokyo",
      country: "Japan",
      mode: "in-person",
      themes: ["robotics"],
      deadline: "2026-10-01",
      startDate: "2026-10-15",
      endDate: "2026-10-17",
      officialUrl: "https://tokyo-robotics.example.com/fair",
      applyUrl: "https://tokyo-robotics.example.com/fair/register",
    },
  },
];

export const mockCollector: Collector = {
  source: "mock",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("mock", startedAt);
    result.leads = MOCK_LEADS.slice(0, input.maxResults);
    result.durationMs = Date.now() - startedAt;
    return result;
  },
};

/** @deprecated Use mockCollector.collect via registry */
export async function collectMockLeads(_preferences: DiscoveryPreferences): Promise<RawLead[]> {
  const result = await mockCollector.collect({
    preferences: _preferences,
    maxResults: _preferences.maxResults,
    timeoutMs: 15_000,
    dryRun: true,
  });
  return result.leads;
}
