import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DomExtractionSchema,
  InferredEventSchema,
} from "@/experiments/scraper-v2/generic/types";

export type CachedAdapter = {
  sourceUrl: string;
  pageFingerprint: string;
  schema: InferredEventSchema | DomExtractionSchema;
  validationMetrics: {
    titleCompleteness: number;
    urlCompleteness: number;
    duplicateRate: number;
    validSampleRate: number;
  };
  updatedAt: string;
};

export type AdapterCacheValidation = {
  valid: boolean;
  reasons: string[];
};

export function adapterCacheId(sourceUrl: string): string {
  return createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);
}

export function validateCachedAdapter(input: {
  cached: CachedAdapter;
  currentPageFingerprint: string;
  currentMetrics: CachedAdapter["validationMetrics"];
}): AdapterCacheValidation {
  const reasons: string[] = [];
  if (input.cached.pageFingerprint !== input.currentPageFingerprint) reasons.push("page fingerprint changed");
  if (input.currentMetrics.titleCompleteness < Math.max(0.75, input.cached.validationMetrics.titleCompleteness - 0.2)) {
    reasons.push("title completeness dropped");
  }
  if (input.currentMetrics.urlCompleteness < Math.max(0.5, input.cached.validationMetrics.urlCompleteness - 0.25)) {
    reasons.push("URL completeness dropped");
  }
  if (input.currentMetrics.duplicateRate > Math.min(0.5, input.cached.validationMetrics.duplicateRate + 0.2)) {
    reasons.push("duplicate rate rose");
  }
  if (input.currentMetrics.validSampleRate < 0.8) reasons.push("validation sample failed");
  return { valid: reasons.length === 0, reasons };
}

export class LocalAdapterCache {
  constructor(private readonly rootDir: string) {}

  async save(adapter: CachedAdapter): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(join(this.rootDir, `${adapterCacheId(adapter.sourceUrl)}.json`), `${JSON.stringify(adapter, null, 2)}\n`, "utf8");
  }

  async load(sourceUrl: string): Promise<CachedAdapter | undefined> {
    try {
      const raw = await readFile(join(this.rootDir, `${adapterCacheId(sourceUrl)}.json`), "utf8");
      const parsed = JSON.parse(raw) as CachedAdapter;
      if (!parsed.sourceUrl || !parsed.pageFingerprint || !parsed.schema) return undefined;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
