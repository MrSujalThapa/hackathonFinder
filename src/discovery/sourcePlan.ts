import type { SourceName } from "@/core/discovery/types";
import type { SourceAvailability } from "@/discovery/selectSources";

export type SourcePlanState =
  | "execute"
  | "skip_disabled"
  | "skip_unconfigured"
  | "skip_auth_required"
  | "skip_degraded"
  | "skip_explicit_user_exclusion";

export type PlannerSourceIntent = {
  source: SourceName;
  enabled: boolean;
  query?: string;
  reason: string;
};

export type ReconciledSourcePlanItem = {
  source: SourceName;
  state: SourcePlanState;
  reason?: string;
  query?: string;
  restored?: boolean;
};

export type ReconciledSourcePlan = {
  sources: SourceName[];
  items: ReconciledSourcePlanItem[];
  warnings: string[];
};

function reasonForUnavailable(availability?: SourceAvailability): string | undefined {
  return availability?.reason;
}

function stateForAvailability(
  source: SourceName,
  availability?: SourceAvailability,
): Exclude<SourcePlanState, "execute"> | undefined {
  if (!availability) return undefined;
  if (!availability.enabled || availability.health === "disabled") {
    return "skip_disabled";
  }
  if (availability.health === "unconfigured") return "skip_unconfigured";
  if (availability.health === "auth_required" || availability.health === "disconnected") {
    return "skip_auth_required";
  }
  if (availability.health === "degraded") return "skip_degraded";
  if (source === "x") return "skip_explicit_user_exclusion";
  return undefined;
}

/**
 * Reconcile LLM source intent with the authoritative effective source list.
 *
 * The LLM may annotate, order, and propose degraded-source skips, but a missing
 * healthy effective source is restored. This prevents planner omissions from
 * silently changing which collectors execute.
 */
export function reconcileSourcePlan(input: {
  effectiveSources: SourceName[];
  plannerSources?: SourceName[];
  plannerIntents?: PlannerSourceIntent[];
  availabilityBySource?: Partial<Record<SourceName, SourceAvailability>>;
}): ReconciledSourcePlan {
  const effective = [...new Set(input.effectiveSources)];
  const effectiveSet = new Set(effective);
  const plannerSources = [...new Set(input.plannerSources ?? [])].filter((source) =>
    effectiveSet.has(source),
  );
  const intentBySource = new Map<SourceName, PlannerSourceIntent>();
  for (const intent of input.plannerIntents ?? []) {
    if (effectiveSet.has(intent.source) && !intentBySource.has(intent.source)) {
      intentBySource.set(intent.source, intent);
    }
  }

  const ordered = [
    ...plannerSources,
    ...effective.filter((source) => !plannerSources.includes(source)),
  ];
  const warnings: string[] = [];
  const items: ReconciledSourcePlanItem[] = [];

  for (const source of ordered) {
    const intent = intentBySource.get(source);
    const availability = input.availabilityBySource?.[source];
    const unavailableState = stateForAvailability(source, availability);
    const missingFromPlanner = !plannerSources.includes(source);

    if (unavailableState && unavailableState !== "skip_degraded") {
      items.push({
        source,
        state: unavailableState,
        reason: reasonForUnavailable(availability) ?? `${source} is not usable`,
        query: intent?.query,
      });
      continue;
    }

    if (intent && !intent.enabled && unavailableState === "skip_degraded") {
      items.push({
        source,
        state: "skip_degraded",
        reason: intent.reason || reasonForUnavailable(availability) || `${source} is degraded`,
        query: intent.query,
      });
      continue;
    }

    if (intent && !intent.enabled) {
      warnings.push(
        `Planner tried to skip healthy effective source ${source}; source was restored for execution.`,
      );
    } else if (missingFromPlanner) {
      warnings.push(
        `Planner omitted effective source ${source}; source was restored for execution.`,
      );
    }

    items.push({
      source,
      state: "execute",
      reason: intent?.reason,
      query: intent?.query,
      restored: missingFromPlanner,
    });
  }

  return {
    sources: items
      .filter((item) => item.state === "execute")
      .map((item) => item.source),
    items,
    warnings,
  };
}
