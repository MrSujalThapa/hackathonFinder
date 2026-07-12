/**
 * One-time cleanup: consolidate duplicate candidate_evidence using the same
 * normalizeEvidenceUrlKey() as the application write path.
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-evidence.ts --dry-run
 *   npx tsx scripts/cleanup-duplicate-evidence.ts --apply
 *
 * Requires migration 005 columns (url_key, first_seen_at, last_seen_at, seen_count).
 * Does not insert synthetic rows. Never prints secrets.
 */
import { loadLocalEnv } from "../src/cli/loadEnv";
import { createClient } from "@supabase/supabase-js";
import { normalizeEvidenceUrlKey } from "../src/lib/http/evidenceUrl";

type EvidenceRow = {
  id: string;
  candidate_id: string;
  type: string;
  url: string | null;
  title: string | null;
  snippet: string | null;
  found_at: string;
  created_at: string;
  url_key?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  seen_count?: number;
  agent_run_id?: string | null;
};

async function main(): Promise<number> {
  loadLocalEnv();
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return 1;
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.from("candidate_evidence").select("*");
  if (error) {
    console.error(`Failed to load evidence: ${error.message}`);
    return 1;
  }

  const rows = (data ?? []) as EvidenceRow[];
  const groups = new Map<string, EvidenceRow[]>();

  for (const row of rows) {
    const keyPart = normalizeEvidenceUrlKey(row.url);
    const groupKey = `${row.candidate_id}|${row.type}|${keyPart}`;
    const list = groups.get(groupKey) ?? [];
    list.push(row);
    groups.set(groupKey, list);
  }

  let keepCount = 0;
  let deleteCount = 0;
  let bumpCount = 0;

  for (const [groupKey, list] of groups) {
    const urlKey = groupKey.split("|").slice(2).join("|");
    list.sort((a, b) => {
      const aFirst = a.first_seen_at ?? a.found_at ?? a.created_at;
      const bFirst = b.first_seen_at ?? b.found_at ?? b.created_at;
      return aFirst.localeCompare(bFirst) || a.id.localeCompare(b.id);
    });
    const keep = list[0]!;
    const firstSeen = list.reduce((min, row) => {
      const value = row.first_seen_at ?? row.found_at ?? row.created_at;
      return value < min ? value : min;
    }, keep.first_seen_at ?? keep.found_at ?? keep.created_at);
    const lastSeen = list.reduce((max, row) => {
      const value = row.last_seen_at ?? row.found_at ?? row.created_at;
      return value > max ? value : max;
    }, keep.last_seen_at ?? keep.found_at ?? keep.created_at);
    const seenCount = list.reduce((sum, row) => sum + (row.seen_count ?? 1), 0);
    const latestRun = list
      .map((row) => row.agent_run_id)
      .filter(Boolean)
      .at(-1) ?? null;

    keepCount += 1;
    if (list.length > 1) {
      bumpCount += 1;
      deleteCount += list.length - 1;
      console.log(
        `group ${groupKey}: keep ${keep.id}, merge ${list.length - 1} dups, seen=${seenCount}`,
      );
    }

    if (!apply) continue;

    const { error: updateError } = await supabase
      .from("candidate_evidence")
      .update({
        url_key: urlKey,
        first_seen_at: firstSeen,
        last_seen_at: lastSeen,
        seen_count: seenCount,
        agent_run_id: latestRun,
      })
      .eq("id", keep.id);
    if (updateError) {
      console.error(`Failed to update ${keep.id}: ${updateError.message}`);
      return 1;
    }

    for (const dup of list.slice(1)) {
      const { error: deleteError } = await supabase
        .from("candidate_evidence")
        .delete()
        .eq("id", dup.id);
      if (deleteError) {
        console.error(`Failed to delete ${dup.id}: ${deleteError.message}`);
        return 1;
      }
    }
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY RUN"} — groups=${keepCount}, groups_with_dups=${bumpCount}, rows_to_delete=${deleteCount}`,
  );
  if (!apply) {
    console.log("Re-run with --apply to consolidate.");
  }
  return 0;
}

void main().then((code) => process.exit(code));
