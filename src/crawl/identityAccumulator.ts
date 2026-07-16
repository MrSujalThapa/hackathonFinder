import type { ListingCard } from "@/crawl/types";

/**
 * Stable identity accumulation with duplicate accounting.
 * Kernel-owned — no source-specific logic.
 */
export class IdentityAccumulator {
  private readonly byIdentity = new Map<string, ListingCard>();
  private rawSeen = 0;
  private duplicateCount = 0;

  get size(): number {
    return this.byIdentity.size;
  }

  get collectedRaw(): number {
    return this.rawSeen;
  }

  get duplicates(): number {
    return this.duplicateCount;
  }

  get identities(): ReadonlySet<string> {
    return new Set(this.byIdentity.keys());
  }

  values(): ListingCard[] {
    return [...this.byIdentity.values()];
  }

  /**
   * Merge a growth step. Returns how many new unique identities were added.
   */
  merge(cards: ListingCard[]): { added: number; duplicates: number; duplicateRate: number } {
    let added = 0;
    let duplicates = 0;
    for (const card of cards) {
      this.rawSeen += 1;
      const identity = card.identity.trim();
      if (!identity) {
        duplicates += 1;
        this.duplicateCount += 1;
        continue;
      }
      if (this.byIdentity.has(identity)) {
        duplicates += 1;
        this.duplicateCount += 1;
        continue;
      }
      this.byIdentity.set(identity, card);
      added += 1;
    }
    const total = added + duplicates;
    return {
      added,
      duplicates,
      duplicateRate: total > 0 ? duplicates / total : 0,
    };
  }
}
