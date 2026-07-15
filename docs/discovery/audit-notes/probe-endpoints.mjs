/**
 * Bounded read-only HTTP probes for SOURCE_AUDIT.
 * Does not import app collectors; only hits public listing URLs.
 */
const urls = [
  ["mlh", "https://www.mlh.com/events"],
  ["hacklist", "https://hacklist-omega.vercel.app/"],
  ["devpost", "https://devpost.com/hackathons?status[]=upcoming"],
  ["luma", "https://lu.ma/discover?q=hackathon"],
  ["hakku", "https://tryhakku.vercel.app/swipe"],
];

function sniff(name, text) {
  const lower = text.toLowerCase();
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  const base = {
    len: text.length,
    title: (titleMatch?.[1] ?? "").trim().slice(0, 100),
    hasNextData: /__NEXT_DATA__/i.test(text),
    hasLogin: /welcome back|enter your credentials|sign in to continue/i.test(lower),
  };

  if (name === "mlh") {
    return {
      ...base,
      hasInertiaPage: /data-page=["']app["']/i.test(text),
      hasUpcomingEvents: /upcomingEvents/i.test(text),
      hasEventWrapper: /event-wrapper|event-name/i.test(text),
    };
  }
  if (name === "hacklist") {
    return {
      ...base,
      hasArticleAria: /<article[^>]*aria-label=/i.test(text),
      cardCountHint: (text.match(/<article/gi) ?? []).length,
    };
  }
  if (name === "devpost") {
    return {
      ...base,
      hasChallengeLinks: /\.devpost\.com|challenge-listing|block-wrapper-link/i.test(text),
      challengeHrefCount: (text.match(/href=["'][^"']*devpost\.com/gi) ?? []).length,
    };
  }
  if (name === "luma") {
    return {
      ...base,
      hasEventCard: /event-card|data-testid=["']event/i.test(text),
      mentionsHackathon: /hackathon/i.test(text),
    };
  }
  return {
    ...base,
    mentionsSwipe: /swipe/i.test(lower),
  };
}

async function probe(name, url) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "hackathonFinder-source-audit/1.0",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    const text = await res.text();
    return {
      name,
      status: res.status,
      ms: Date.now() - t0,
      finalUrl: res.url,
      ...sniff(name, text),
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      name,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - t0,
    };
  }
}

const results = [];
for (const [name, url] of urls) {
  results.push(await probe(name, url));
}
console.log(JSON.stringify(results, null, 2));
