/**
 * Natural-language custom-source mention matching.
 * Used so "from <custom name/slug>" resolves like "from Devpost" (exclusive selection).
 */
export type CustomSourceMention = {
  id: string;
  slug: string;
  name: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function commandMentionsCustomSource(
  command: string,
  source: Pick<CustomSourceMention, "slug" | "name">,
): boolean {
  const candidates = [source.slug, source.name]
    .map((value) => value.trim())
    .filter((value) => value.length >= 3);
  for (const candidate of candidates) {
    if (new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(command)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns enabled custom sources mentioned in the query text.
 * Empty result means no exclusive NL custom restriction.
 */
export function matchCustomSourcesInNaturalLanguage(
  command: string,
  sources: CustomSourceMention[],
): CustomSourceMention[] {
  const matched: CustomSourceMention[] = [];
  for (const source of sources) {
    if (commandMentionsCustomSource(command, source)) {
      matched.push(source);
    }
  }
  return matched;
}
