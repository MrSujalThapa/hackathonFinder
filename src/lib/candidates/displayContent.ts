/**
 * Display-only content normalization for candidate summaries/descriptions.
 * Does not mutate stored evidence or provenance.
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
  /home\s*[>|/]\s*events\s*[>|/]/gi,
  /nav(?:igation)?\s*:\s*.+$/gim,
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
  for (const pattern of [...DEVPOST_BOILERPLATE, ...MARKETING_FILLER]) {
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

function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0 && text.trim()) return [text.trim()];
  return parts;
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
  text = stripBoilerplate(text);
  text = normalizeWhitespace(text);
  text = stripRepeatedContext(text, ctx);
  text = normalizeWhitespace(text);
  return text;
}

/**
 * Sentence-aware truncation. Never cuts mid-word.
 * Prefer 2–4 sentences for queue summaries.
 */
export function truncateToSentences(
  text: string,
  opts: { minSentences?: number; maxSentences?: number; maxChars?: number } = {},
): string {
  const minSentences = opts.minSentences ?? 2;
  const maxSentences = opts.maxSentences ?? 4;
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
  summary?: string | null;
  description?: string | null;
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

/**
 * Prefer grounded summary when present; otherwise clean description.
 * Queue: 2–4 sentences. Never mid-word truncate.
 */
export function getQueueSummary(candidate: CandidateDisplayFields): string {
  const ctx: DisplayContentContext = {
    title: candidate.name,
    location: locationLabel(candidate),
    dateText: dateLabel(candidate),
  };
  const preferred = cleanDisplayText(candidate.summary, ctx);
  const fallback = cleanDisplayText(candidate.description, ctx);
  const source = preferred || fallback;
  if (!isUsable(source)) return UNRELIABLE;
  return truncateToSentences(source, { minSentences: 2, maxSentences: 4, maxChars: 420 });
}

/**
 * Detail description as readable paragraphs. Prefer description, else summary.
 */
export function getDetailDescription(candidate: CandidateDisplayFields): string[] {
  const ctx: DisplayContentContext = {
    title: candidate.name,
    location: locationLabel(candidate),
    dateText: dateLabel(candidate),
  };
  const preferred = cleanDisplayText(candidate.description, ctx);
  const fallback = cleanDisplayText(candidate.summary, ctx);
  const source = preferred || fallback;
  if (!isUsable(source)) return [UNRELIABLE];
  return toReadableParagraphs(source);
}

export const DISPLAY_CONTENT_FALLBACK = UNRELIABLE;
