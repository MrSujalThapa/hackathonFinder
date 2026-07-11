import type { SourceName } from "@/core/discovery/types";
import { devpostCollector } from "@/collectors/devpost";
import { hacklistCollector } from "@/collectors/hacklist";
import { hakkuCollector } from "@/collectors/hakku";
import { mockCollector } from "@/collectors/mock";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";

const COLLECTORS: Partial<Record<SourceName, Collector>> = {
  mock: mockCollector,
  hacklist: hacklistCollector,
  hakku: hakkuCollector,
  devpost: devpostCollector,
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
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .filter((part): part is SourceName => allowed.has(part as SourceName));
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
