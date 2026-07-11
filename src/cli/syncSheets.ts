import { loadLocalEnv } from "@/cli/loadEnv";
import { syncPendingApproved } from "@/server/sheets/syncPendingApproved";

function printHelp(): void {
  console.log(`Usage:
  npm run sync:sheets -- [--dry-run] [--limit=50]

Sync APPROVED candidates that are not confirmed in Google Sheets.
Idempotent: will not create duplicate rows for the same Candidate ID.
`);
}

function parseArgs(argv: string[]): { dryRun: boolean; limit: number; help: boolean } {
  let dryRun = false;
  let limit = 50;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      limit = Math.min(Math.floor(value), 200);
    } else if (arg.trim()) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, limit, help };
}

async function main(): Promise<number> {
  loadLocalEnv();

  let options: { dryRun: boolean; limit: number; help: boolean };
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    return 1;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  console.log(
    options.dryRun
      ? `Dry-run: checking up to ${options.limit} unsynced APPROVED candidates…`
      : `Syncing up to ${options.limit} unsynced APPROVED candidates…`,
  );

  const summary = await syncPendingApproved({
    dryRun: options.dryRun,
    limit: options.limit,
  });

  console.log("");
  console.log("Sheet sync summary");
  console.log(`  checked:   ${summary.checked}`);
  console.log(`  appended:  ${summary.appended}`);
  console.log(`  already:   ${summary.already_synced}`);
  console.log(`  recovered: ${summary.recovered}`);
  console.log(`  skipped:   ${summary.skipped}`);
  console.log(`  failed:    ${summary.failed}`);
  console.log(`  mock:      ${summary.mock_synced}`);
  if (options.dryRun) {
    console.log(`  planned:   ${summary.dry_run}`);
    console.log("  (dry-run — no Sheet writes, no Supabase updates)");
  }

  if (summary.results?.length) {
    console.log("");
    for (const result of summary.results) {
      const row = result.rowId ? ` row=${result.rowId}` : "";
      const msg = result.message ? ` — ${result.message}` : "";
      console.log(`  - ${result.candidateId}: ${result.status}${row}${msg}`);
    }
  }

  return summary.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("sync:sheets failed:", error);
    process.exit(1);
  });
