import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DateCoverageSummary } from "@/experiments/scraper-v2/generic/types";

export type CrawlCheckpoint = {
  sourceUrl: string;
  pageFingerprint: string;
  paginationState?: unknown;
  seenIdentityHashes: string[];
  pagesCompleted: number;
  recordsObserved: number;
  dateCoverage: DateCoverageSummary;
  updatedAt: string;
};

export function checkpointId(input: {
  sourceUrl: string;
  profile: string;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
}): string {
  return createHash("sha256")
    .update([input.sourceUrl, input.profile, input.dateHorizonStart ?? "", input.dateHorizonEnd ?? ""].join("|"))
    .digest("hex")
    .slice(0, 24);
}

export class LocalCheckpointStore {
  constructor(private readonly rootDir: string) {}

  async save(id: string, checkpoint: CrawlCheckpoint): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(join(this.rootDir, `${id}.json`), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  }

  async load(id: string): Promise<CrawlCheckpoint | undefined> {
    try {
      const raw = await readFile(join(this.rootDir, `${id}.json`), "utf8");
      const parsed = JSON.parse(raw) as CrawlCheckpoint;
      if (!parsed.sourceUrl || !parsed.pageFingerprint || !Array.isArray(parsed.seenIdentityHashes)) return undefined;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
