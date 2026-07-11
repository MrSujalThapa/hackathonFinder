/**
 * Read-only audit of candidate `source` values in Supabase.
 * Never mutates data. Never deletes rows.
 *
 * Usage: npm run candidates:audit-sources
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../src/cli/loadEnv";

type CandidateSourceRow = {
  id: string;
  name: string;
  status: string;
  source: string;
  official_url: string | null;
};

function hostnameFromUrl(url: string | null): string {
  if (!url) return "(none)";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

async function main(): Promise<number> {
  console.log("=== Candidate source audit (read-only) ===\n");

  loadLocalEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const useMock =
    process.env.USE_MOCK_CANDIDATES === "true" ||
    process.env.USE_MOCK_CANDIDATES === "1";

  console.log(`USE_MOCK_CANDIDATES: ${useMock ? "true" : "false"}`);

  if (!present(url) || !present(serviceKey)) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    return 1;
  }

  const supabase = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("candidates")
    .select("id, name, status, source, official_url");

  if (error) {
    console.error(`Query failed: ${error.message}`);
    return 1;
  }

  const rows = (data ?? []) as CandidateSourceRow[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.source || "(empty)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  console.log("\n--- Source counts ---");
  const sortedSources = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (sortedSources.length === 0) {
    console.log("(no candidates)");
  } else {
    for (const [source, count] of sortedSources) {
      console.log(`${source}: ${count}`);
    }
  }
  console.log(`total: ${rows.length}`);

  const mockRows = rows.filter((row) => row.source === "mock");
  console.log(`\n--- Rows with source='mock' (${mockRows.length}) ---`);
  if (mockRows.length === 0) {
    console.log("(none)");
  } else {
    for (const row of mockRows) {
      console.log(
        `${row.id}\t${row.status}\t${hostnameFromUrl(row.official_url)}\t${row.name}`,
      );
    }
  }

  if (mockRows.length > 0 && !useMock) {
    console.log(
      "\nHINT: Mock-sourced rows exist in Supabase while USE_MOCK_CANDIDATES=false.",
    );
    console.log(
      "The UI reads the live DB, so these rows can still appear in the queue.",
    );
    console.log(
      "USE_MOCK_CANDIDATES=false disables the in-memory mock store only;",
    );
    console.log(
      "it does not remove prior agent writes with source='mock'. Do not auto-delete.",
    );
    console.log(
      "Identify with: SELECT id, name, status, source, official_url FROM candidates WHERE source = 'mock';",
    );
  }

  console.log("\nRESULT: OK (read-only; no mutations)");
  return 0;
}

void main().then((code) => {
  process.exit(code);
});
