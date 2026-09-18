/**
 * Runs the real discovery pipeline (live sources, dry-run persistence) for a
 * batch of queries and reports date/location metadata completeness plus a
 * lifecycle breakdown (see src/core/lifecycle.ts). Used to verify discovery
 * is not mass-rejecting incomplete metadata. Dry-run only — no candidate
 * writes.
 *
 * Usage: npx tsx scripts/live-discovery-quality-report.ts "query one" "query two"
 */
import { loadLocalEnv } from "@/cli/loadEnv";

loadLocalEnv();

async function main(): Promise<void> {
  const { runDiscovery } = await import("@/discovery");
  const { classifyAcceptedLifecycle, classifyRejectedLifecycle, emptyLifecycleTally } = await import(
    "@/core/lifecycle"
  );
  const { eventStartFor, eventEndFor, applicationDeadlineFor } = await import("@/core/dates");
  type HackathonEvent = import("@/core/discovery/types").HackathonEvent;

  const queries = process.argv.slice(2);
  if (queries.length === 0) {
    console.error("Usage: tsx scripts/live-discovery-quality-report.ts \"query one\" [\"query two\" ...]");
    process.exit(1);
  }

  const now = new Date();
  const overall = emptyLifecycleTally();

  for (const query of queries) {
    console.log(`\n=== ${query} ===`);
    const { summary } = await runDiscovery({
      command: query,
      mode: "deterministic",
      dryRun: true,
      maxResults: 40,
      sourceTimeoutMs: 45_000,
      totalTimeoutMs: 180_000,
    });

    const tally = emptyLifecycleTally();
    let withEventDate = 0;
    let withApplicationDeadline = 0;
    let unknownDate = 0;
    let unknownLocation = 0;

    for (const item of summary.acceptedCandidates) {
      const asEvent: Pick<
        HackathonEvent,
        "eventStartDate" | "eventEndDate" | "registrationDeadline" | "applicationDeadline" | "deadline"
      > = {
        eventStartDate: item.eventStartDate,
        eventEndDate: item.eventEndDate,
        registrationDeadline: item.applicationDeadline,
        applicationDeadline: undefined,
        deadline: undefined,
      };
      const bucket = classifyAcceptedLifecycle(
        { event: asEvent as HackathonEvent, status: item.status as "NEW" | "NEEDS_REVIEW" },
        now,
      );
      tally[bucket] += 1;
      if (eventStartFor(asEvent as HackathonEvent)) withEventDate += 1;
      else unknownDate += 1;
      if (applicationDeadlineFor(asEvent as HackathonEvent)) withApplicationDeadline += 1;
      if (!item.location || item.location === "Unknown") unknownLocation += 1;
      void eventEndFor;
    }

    for (const item of summary.rejectedCandidates) {
      tally[classifyRejectedLifecycle(item)] += 1;
    }

    for (const key of Object.keys(overall) as Array<keyof typeof overall>) {
      overall[key] += tally[key];
    }

    const total = summary.acceptedCandidates.length + summary.rejectedCandidates.length;
    console.log(`total=${total} accepted=${summary.accepted} rejected=${summary.rejected}`);
    console.log(
      `lifecycle: ACTIONABLE=${tally.ACTIONABLE} LIKELY_ACTIONABLE=${tally.LIKELY_ACTIONABLE} NEEDS_REVIEW=${tally.NEEDS_REVIEW} STALE=${tally.STALE} REJECTED=${tally.REJECTED}`,
    );
    console.log(
      `metadata: withEventDate=${withEventDate} withApplicationDeadline=${withApplicationDeadline} unknownDate=${unknownDate} unknownLocation=${unknownLocation}`,
    );
    console.log(`raw: ${summary.rawLeads} unique: ${summary.uniqueLeads} extracted: ${summary.extracted}`);
    const rejectionReasons = new Map<string, number>();
    for (const item of summary.rejectedCandidates) {
      rejectionReasons.set(item.reason, (rejectionReasons.get(item.reason) ?? 0) + 1);
    }
    const topReasons = [...rejectionReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [reason, count] of topReasons) {
      console.log(`  ${count}x ${reason}`.slice(0, 160));
    }
    if (summary.warnings.length > 0) {
      console.log(`warnings: ${summary.warnings.length} (first: ${summary.warnings[0]})`);
    }
    if (summary.errors.length > 0) {
      console.log(`errors: ${summary.errors.join(" | ").slice(0, 300)}`);
    }
  }

  console.log("\n=== OVERALL ===");
  console.log(JSON.stringify(overall));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
