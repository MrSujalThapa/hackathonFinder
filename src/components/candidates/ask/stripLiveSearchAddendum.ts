const LIVE_SEARCH_MARKERS = [
  /\s*Live search addendum:\s*.+$/i,
  /\s*Live search found related notes(?:\s*\([^)]*\))?:\s*.+$/i,
];

const CERTAINTY_PREFIXES = [
  /^Inferred from available evidence:\s*/i,
  /^Evidence may conflict:\s*/i,
];

/**
 * Presentation guard: strip legacy live-search dump suffixes and certainty
 * prefixes from persisted factual answer strings before display.
 */
export function stripLiveSearchAddendum(text: string): string {
  let cleaned = text.trim();
  if (!cleaned) return "";

  for (const prefix of CERTAINTY_PREFIXES) {
    cleaned = cleaned.replace(prefix, "");
  }

  for (const marker of LIVE_SEARCH_MARKERS) {
    cleaned = cleaned.replace(marker, "");
  }

  // Collapse accidental double spaces left by stripping mid-string.
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/** Cap factual body to a few short visual blocks (paragraphs). */
export function factualAnswerBlocks(text: string, maxBlocks = 3): string[] {
  const cleaned = stripLiveSearchAddendum(text);
  if (!cleaned) return [];

  const paragraphs = cleaned
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) {
    return paragraphs.slice(0, maxBlocks);
  }

  // Single blob: keep as one block unless extremely long — still one lead.
  return [cleaned];
}
