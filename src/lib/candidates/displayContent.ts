/**
 * Display-only content normalization for candidate summaries/descriptions.
 * Does not mutate stored evidence or provenance.
 *
 * Priority for queue/detail copy:
 * 1. verified grounded summary
 * 2. cleaned extracted description
 * 3. sentence-level source summary
 * 4. "No reliable description available"
 */

const UNRELIABLE = "No reliable description available";

const DEVPOST_BOILERPLATE = [
  /find\s+your\s+next\s+hackathon(?:\s+on\s+devpost)?/gi,
  /\bon\s+devpost\b/gi,
  /devpost\s+is\s+the\s+home\s+for\s+hackathons/gi,
  /browse\s+hackathons/gi,
  /host\s+a\s+hackathon/gi,
  /join\s+devpost/gi,
  /sign\s+up\s+to\s+save/gi,
  /follow\s+us\s+on\s+(twitter|x|linkedin|facebook|instagram)/gi,
  /©\s*\d{4}\s*devpost/gi,
  /all\s+rights\s+reserved/gi,
  /privacy\s+policy/gi,
  /terms\s+of\s+service/gi,
  /cookie\s+settings/gi,
  /log\s+in\s*[|/]\s*sign\s+up/gi,
  /search\s+hackathons/gi,
  /featured\s+hackathons/gi,
  /online\s+hackathons\s*[|/]\s*in-?person/gi,
];

const MARKETING_FILLER = [
  /don't\s+miss\s+(out|this)/gi,
  /register\s+now[!?.]*/gi,
  /limited\s+spots\s+available[!?.]*/gi,
  /apply\s+today[!?.]*/gi,
  /join\s+thousands\s+of\s+(builders|hackers|developers)/gi,
  /the\s+ultimate\s+hackathon\s+experience/gi,
  /click\s+here\s+to\s+(learn\s+more|apply|register)/gi,
  /share\s+this\s+event/gi,
  /add\s+to\s+calendar/gi,
  /back\s+to\s+(events|home|hackathons)/gi,
  /home\s*[>/|]\s*events(?:\s*[>/|]\s*[A-Za-z][\w-]*)?/gi,
  /nav(?:igation)?\s*:\s*/gi,
  /skip\s+to\s+(main\s+)?content/gi,
  /main\s+menu/gi,
  /toggle\s+(navigation|menu)/gi,
  /open\s+menu/gi,
  /breadcrumb[s]?\s*:\s*/gi,
];

const COC_BOILERPLATE = [
  /(?:mlh\s+)?code\s+of\s+conduct[:.\s]*/gi,
  /by\s+participating(?:\s+in\s+this\s+event)?,?\s+you\s+agree\s+to\s+(?:follow|abide\s+by)[^.?!]*[.?!]?/gi,
  /all\s+participants\s+(?:are\s+)?expected\s+to\s+(?:follow|abide\s+by)[^.?!]*[.?!]?/gi,
  /harassment\s+(?:of\s+any\s+kind\s+)?(?:will\s+not\s+be\s+tolerated|is\s+prohibited)[^.?!]*[.?!]?/gi,
  /we\s+(?:are\s+)?committed\s+to\s+(?:providing\s+)?a\s+(?:safe|respectful|inclusive)(?:\s+and\s+\w+)*\s+environment[^.?!]*[.?!]?/gi,
  /please\s+report\s+(?:any\s+)?(?:violations|incidents|concerns)\s+to[^.?!]*[.?!]?/gi,
  /be\s+excellent\s+to\s+each\s+other[^.?!]*[.?!]?/gi,
  /violators\s+(?:may|will)\s+be\s+(?:removed|expelled|banned)[^.?!]*[.?!]?/gi,
  /read\s+(?:our|the)\s+(?:full\s+)?code\s+of\s+conduct[^.?!]*[.?!]?/gi,
];

const HTML_REMNANTS = /<\/?[^>]+>/g;
const ENTITY_RE = /&(?:nbsp|amp|lt|gt|quot|#39);/gi;

export type DisplayContentContext = {
  title?: string | null;
  location?: string | null;
  dateText?: string | null;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(text: string): string {
  return decodeEntities(text.replace(HTML_REMNANTS, " ").replace(ENTITY_RE, " "));
}

function stripMarkdownHeadings(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[ \t]#{1,6}[ \t]+/g, " ");
}

function stripCodeOfConductSections(text: string): string {
  // Drop heading-led CoC / community-guidelines walls until the next heading.
  return text.replace(
    /(?:^|\n+)(?:#{1,6}\s*)?(?:our\s+)?(?:code\s+of\s+conduct|community\s+guidelines|rules\s+of\s+conduct)\b[\s\S]*?(?=(?:\n+#{1,6}\s|\n{2,}[A-Z][a-z]|$))/gi,
    "\n",
  );
}

function stripMalformedBullets(text: string): string {
  return text
    // Drop lines that are only bullet/list markers.
    .replace(/^[ \t]*(?:[-*•▪◦]+|\d+[.)])[ \t]*$/gm, "")
    // Strip leading list markers but keep the item text.
    .replace(/^[ \t]*(?:[-*•▪◦+]|\d+[.)])[ \t]+(?=\S)/gm, "")
    // Collapse doubled orphan bullets mid-line.
    .replace(/(?:^|[\s])(?:[-*•▪◦]\s*){2,}(?=\S)/g, " ")
    // Remove trailing orphan bullet markers.
    .replace(/[ \t]+[-*•▪◦]+[ \t]*$/gm, "");
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\|+/g, " · ")
    .replace(/-{3,}/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function stripBoilerplate(text: string): string {
  let out = text;
  for (const pattern of [...DEVPOST_BOILERPLATE, ...MARKETING_FILLER, ...COC_BOILERPLATE]) {
    out = out.replace(pattern, " ");
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRepeatedContext(text: string, ctx: DisplayContentContext): string {
  let out = text;
  const pieces = [ctx.title, ctx.location, ctx.dateText].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (trimmed.length < 3) continue;
    const re = new RegExp(`(?:^|[\\s·|,;-]+)${escapeRegExp(trimmed)}(?=$|[\\s·|,;.!?-]+)`, "gi");
    // Keep the first occurrence; remove later duplicates.
    let seen = false;
    out = out.replace(re, (match) => {
      if (!seen) {
        seen = true;
        return match;
      }
      return " ";
    });
    // If the whole text starts with the title repeated as a sentence, drop leading clone.
    const leading = new RegExp(`^${escapeRegExp(trimmed)}[\\s.:\\-–—]*`, "i");
    if (leading.test(out) && out.length > trimmed.length + 12) {
      const without = out.replace(leading, "").trim();
      if (without.length > 20) out = without;
    }
  }
  return out;
}

/**
 * Drop trailing scrapes that look mid-word / incomplete (no sentence end).
 */
function stripPartialTrailingWords(text: string): string {
  let out = text.trim();
  if (!out) return out;

  // Trailing ellipsis / cut markers without a finished sentence.
  out = out.replace(/\s*(?:\.{2,}|…)\s*$/u, "").trim();

  // Hyphenated cut-off at end: "machine-learni-" or "machine-learni"
  out = out.replace(/\s+\S+-(?:\s*|[A-Za-z]{1,10})$/u, "").trim();

  if (/[.!?]["')\]]*$/u.test(out)) return out;

  const words = out.split(/\s+/);
  if (words.length < 2) return out;

  const last = words[words.length - 1] ?? "";
  const letters = last.replace(/[^A-Za-z]/g, "");
  const looksPartial =
    letters.length > 0 &&
    letters.length <= 3 &&
    !/^(AI|ML|VR|AR|UI|UX|API|SDK|USA|UK|EU|NYC|SF)$/i.test(letters);

  // Truncated token: no common English ending, often missing vowels near the end.
  const looksCutOff =
    letters.length >= 5 &&
    !/(tion|sion|ment|ness|ings?|ers?|ies|ous|ful|ive|ize|ise|able|ible|ally|ings|ed|ly|ors?|als?|ics?|day|hours?|weekend|event|tracks?|teams?|demo|students?|builders?)$/i.test(
      letters,
    ) &&
    (!/[aeiouy]/i.test(letters.slice(-2)) || letters.length >= 10);

  if (looksPartial || looksCutOff) {
    words.pop();
    out = words.join(" ").trim();
  }

  // If still no terminal punctuation and last token is a dangling connector, drop it.
  out = out.replace(/\s+(?:and|or|the|a|an|of|to|for|with|in|on|at)\s*$/i, "").trim();
  return out;
}

function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0 && text.trim()) return [text.trim()];
  return parts;
}

function isCompleteSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length < 12) return false;
  if (!/[.!?]$/.test(trimmed)) return false;
  const lastWord = trimmed.replace(/[.!?"')\]]+$/u, "").split(/\s+/).pop() ?? "";
  const letters = lastWord.replace(/[^A-Za-z]/g, "");
  if (letters.length > 0 && letters.length <= 2) return false;
  return true;
}

function isUsable(text: string): boolean {
  const cleaned = text.replace(/[^\p{L}\p{N}]+/gu, "");
  return cleaned.length >= 24;
}

export function cleanDisplayText(
  raw: string | null | undefined,
  ctx: DisplayContentContext = {},
): string {
  if (!raw?.trim()) return "";
  let text = stripHtml(raw);
  text = stripMarkdownHeadings(text);
  text = stripCodeOfConductSections(text);
  text = stripMalformedBullets(text);
  text = stripBoilerplate(text);
  text = normalizeWhitespace(text);
  text = stripRepeatedContext(text, ctx);
  text = stripPartialTrailingWords(text);
  text = normalizeWhitespace(text);
  return text;
}

/**
 * Build a short summary from complete sentences only (source excerpt path).
 */
export function buildSentenceSourceSummary(
  raw: string | null | undefined,
  ctx: DisplayContentContext = {},
  opts: { maxSentences?: number; maxChars?: number } = {},
): string {
  const cleaned = cleanDisplayText(raw, ctx);
  if (!cleaned) return "";
  const maxSentences = opts.maxSentences ?? 3;
  const maxChars = opts.maxChars ?? 420;
  const complete = splitSentences(cleaned).filter(isCompleteSentence);
  if (complete.length === 0) return "";
  return truncateToSentences(complete.join(" "), {
    minSentences: 1,
    maxSentences,
    maxChars,
  });
}

/**
 * Sentence-aware truncation. Never cuts mid-word.
 * Queue summaries prefer 2–3 sentences.
 */
export function truncateToSentences(
  text: string,
  opts: { minSentences?: number; maxSentences?: number; maxChars?: number } = {},
): string {
  const minSentences = opts.minSentences ?? 2;
  const maxSentences = opts.maxSentences ?? 3;
  const maxChars = opts.maxChars ?? 420;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return "";

  const picked: string[] = [];
  for (const sentence of sentences) {
    if (picked.length >= maxSentences) break;
    const next = [...picked, sentence].join(" ");
    if (picked.length >= minSentences && next.length > maxChars) break;
    if (sentence.length > maxChars && picked.length === 0) {
      // Single long sentence: word-safe clamp
      const words = sentence.split(/\s+/);
      let buf = "";
      for (const word of words) {
        const trial = buf ? `${buf} ${word}` : word;
        if (trial.length > maxChars - 1) break;
        buf = trial;
      }
      return buf ? `${buf}…` : `${sentence.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
    }
    picked.push(sentence);
  }

  return picked.join(" ").trim();
}

export function toReadableParagraphs(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.replace(/\n/g, " ").trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks;
  const sentences = splitSentences(normalized);
  if (sentences.length <= 3) return [normalized];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    paragraphs.push(sentences.slice(i, i + 3).join(" "));
  }
  return paragraphs;
}

export type CandidateDisplayFields = {
  name?: string | null;
  /** Verified / grounded summary (preferred). */
  summary?: string | null;
  /** Extracted event description. */
  description?: string | null;
  /**
   * Optional sentence-level source excerpt (evidence snippet / scraped blurb).
   * Used only after verified summary and cleaned description fail.
   */
  sourceSummary?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  deadline?: string | null;
};

function locationLabel(c: CandidateDisplayFields): string | null {
  const parts = [c.city ?? c.location, c.country].filter(Boolean);
  return parts.length ? parts.join(", ") : c.location ?? null;
}

function dateLabel(c: CandidateDisplayFields): string | null {
  const parts = [c.startDate, c.endDate, c.deadline].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function displayContext(candidate: CandidateDisplayFields): DisplayContentContext {
  return {
    title: candidate.name,
    location: locationLabel(candidate),
    dateText: dateLabel(candidate),
  };
}

export type DisplaySourceKind =
  | "verified_summary"
  | "cleaned_description"
  | "sentence_source"
  | "fallback";

export type ResolvedDisplaySource = {
  kind: DisplaySourceKind;
  text: string;
};

/**
 * Single source picker for display copy. Does not truncate or paragraph-split.
 */
export function resolveDisplaySource(candidate: CandidateDisplayFields): ResolvedDisplaySource {
  const ctx = displayContext(candidate);

  const verified = cleanDisplayText(candidate.summary, ctx);
  if (isUsable(verified)) {
    return { kind: "verified_summary", text: verified };
  }

  const cleanedDescription = cleanDisplayText(candidate.description, ctx);
  if (isUsable(cleanedDescription)) {
    return { kind: "cleaned_description", text: cleanedDescription };
  }

  const sentenceSource =
    buildSentenceSourceSummary(candidate.sourceSummary, ctx) ||
    buildSentenceSourceSummary(candidate.description, ctx) ||
    buildSentenceSourceSummary(candidate.summary, ctx);
  if (isUsable(sentenceSource)) {
    return { kind: "sentence_source", text: sentenceSource };
  }

  return { kind: "fallback", text: UNRELIABLE };
}

/**
 * Prefer verified summary → cleaned description → sentence source → fallback.
 * Queue: 2–3 sentences. Never mid-word truncate.
 */
export function getQueueSummary(candidate: CandidateDisplayFields): string {
  const resolved = resolveDisplaySource(candidate);
  if (resolved.kind === "fallback") return UNRELIABLE;
  return truncateToSentences(resolved.text, {
    minSentences: 2,
    maxSentences: 3,
    maxChars: 420,
  });
}

/**
 * Detail description as readable paragraphs.
 * Same priority cascade as queue.
 */
export function getDetailDescription(candidate: CandidateDisplayFields): string[] {
  const resolved = resolveDisplaySource(candidate);
  if (resolved.kind === "fallback") return [UNRELIABLE];
  return toReadableParagraphs(resolved.text);
}

export const DISPLAY_CONTENT_FALLBACK = UNRELIABLE;
