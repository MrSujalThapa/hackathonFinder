import type { SourceName } from "@/core/discovery/types";
import { devpostCollector } from "@/collectors/devpost";
import { hacklistCollector } from "@/collectors/hacklist";
import { hakkuCollector } from "@/collectors/hakku";
import { lumaCollector } from "@/collectors/luma";
import { mlhCollector } from "@/collectors/mlh";
import { mockCollector } from "@/collectors/mock";
import { webSearchCollector } from "@/collectors/webSearch";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";

const COLLECTORS: Partial<Record<SourceName, Collector>> = {
  mock: mockCollector,
  hacklist: hacklistCollector,
  hakku: hakkuCollector,
  devpost: devpostCollector,
  mlh: mlhCollector,
  luma: lumaCollector,
  web: webSearchCollector,
};

export function getRegisteredSources(): SourceName[] {
  return Object.keys(COLLECTORS) as SourceName[];
}

export function getCollector(source: SourceName): Collector | undefined {
  return COLLECTORS[source];
}

export function resolveCollectors(sources: SourceName[]): Collector[] {
  const resolved: Collector[] = [];
  const seen = new Set<SourceName>();

  for (const source of sources) {
    if (seen.has(source)) continue;
    seen.add(source);

    const collector = getCollector(source);
    if (collector) {
      resolved.push(collector);
    }
  }

  return resolved;
}

export function parseSourcesFlag(value: string): SourceName[] {
  const allowed = new Set(getRegisteredSources());
  const parts = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const unknown = parts.filter((part) => !allowed.has(part as SourceName));
  if (unknown.length > 0) {
    const registered = getRegisteredSources().join(", ");
    throw new Error(
      `Unknown source(s): ${unknown.join(", ")}. Registered sources: ${registered}`,
    );
  }

  return parts as SourceName[];
}

export async function runCollectors(
  input: CollectorInput,
  sources: SourceName[],
): Promise<CollectorResult[]> {
  const collectors = resolveCollectors(sources);
  const results = await Promise.all(
    collectors.map(async (collector) => {
      const startedAt = Date.now();
      try {
        return await collector.collect(input);
      } catch (error) {
        const result = emptyCollectorResult(collector.source, startedAt);
        result.errors.push(
          error instanceof Error ? error.message : `Collector ${collector.source} failed`,
        );
        return result;
      }
    }),
  );

  return results;
}
