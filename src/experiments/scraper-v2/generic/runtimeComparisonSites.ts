export type RuntimeComparisonSite = {
  slug: string;
  label: string;
  url: string;
  expectedMinimumEventCount?: number;
  allowedOrigins?: string[];
  heldOut?: boolean;
};

export const RUNTIME_COMPARISON_SITES: RuntimeComparisonSite[] = [
  { slug: "devfolio", label: "Devfolio", url: "https://devfolio.co/hackathons" },
  { slug: "devpost", label: "Devpost", url: "https://devpost.com/hackathons", expectedMinimumEventCount: 100 },
  {
    slug: "mlh",
    label: "MLH",
    url: "https://www.mlh.com/events",
    allowedOrigins: ["https://www.mlh.com"],
    expectedMinimumEventCount: 60,
  },
  { slug: "hackathon-radar", label: "Hackathon Radar", url: "https://www.hackathonradar.com/database", expectedMinimumEventCount: 25 },
  { slug: "hackathon-map", label: "Hackathon Map", url: "https://www.hackathonmap.com/" },
  { slug: "hack-club", label: "Hack Club", url: "https://hackathons.hackclub.com/" },
  { slug: "garage48", label: "Garage48", url: "https://garage48.org/events" },
  { slug: "unstop", label: "Unstop", url: "https://unstop.com/hackathons" },
  { slug: "eventbrite", label: "Eventbrite", url: "https://www.eventbrite.com/d/online/hackathon/" },
  { slug: "taikai", label: "TAIKAI", url: "https://taikai.network/en/hackathons" },
  { slug: "dorahacks", label: "DoraHacks", url: "https://dorahacks.io/hackathon" },
  { slug: "hackathons-space", label: "hackathons.space", url: "https://www.hackathons.space/" },
  { slug: "eventornado", label: "Eventornado", url: "https://eventornado.com/events" },
  { slug: "hackerearth", label: "HackerEarth", url: "https://www.hackerearth.com/challenges/hackathon/", heldOut: true },
  { slug: "open-hackathons", label: "Open Hackathons", url: "https://www.openhackathons.org/s/upcoming-events", heldOut: true },
  { slug: "angelhack", label: "AngelHack", url: "https://angelhack.com/events/", heldOut: true },
];
