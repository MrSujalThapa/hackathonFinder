/**
 * Copy approved skills from .agents/skills/ into harness skill directories.
 * Uses Node fs APIs only (Windows-safe). Does not modify canonical files.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  APPROVED_SKILL_NAMES,
  APPROVED_SKILLS,
  CANONICAL_SKILLS_DIR,
  GENERATED_MARKER,
  HARNESS_SKILL_DIRS,
} from "./agent-skills-manifest";

type Counts = {
  copied: string[];
  updated: string[];
  skipped: string[];
  failed: string[];
  removed: string[];
};

function resolveRoot(): string {
  return process.cwd();
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(path.join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function hasGeneratedMarker(skillDir: string): boolean {
  return existsSync(path.join(skillDir, GENERATED_MARKER));
}

function writeMarker(skillDir: string, skillName: string): void {
  const payload = {
    generatedBy: "npm run skills:sync",
    skill: skillName,
    sourceCanonical: path.posix.join(CANONICAL_SKILLS_DIR, skillName),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(skillDir, GENERATED_MARKER),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function copySkill(
  canonicalDir: string,
  destDir: string,
  label: string,
  skillName: string,
  counts: Counts,
): void {
  const existed = existsSync(destDir);
  try {
    if (existed) {
      rmSync(destDir, { recursive: true, force: true });
    }
    mkdirSync(path.dirname(destDir), { recursive: true });
    cpSync(canonicalDir, destDir, { recursive: true });
    writeMarker(destDir, skillName);
    if (existed) counts.updated.push(label);
    else counts.copied.push(label);
  } catch (error) {
    counts.failed.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function syncHarness(
  root: string,
  harnessRel: string,
  counts: Counts,
): void {
  const harnessDir = path.join(root, harnessRel);
  mkdirSync(harnessDir, { recursive: true });

  const approved = new Set(APPROVED_SKILL_NAMES);

  for (const skill of APPROVED_SKILLS) {
    const canonicalDir = path.join(root, CANONICAL_SKILLS_DIR, skill.name);
    const destDir = path.join(harnessDir, skill.name);
    const label = `${harnessRel}/${skill.name}`;
    if (!existsSync(canonicalDir)) {
      counts.failed.push(`${label} missing canonical folder`);
      continue;
    }
    copySkill(canonicalDir, destDir, label, skill.name, counts);
  }

  for (const existing of listDirs(harnessDir)) {
    const skillDir = path.join(harnessDir, existing);
    if (!hasGeneratedMarker(skillDir)) {
      counts.skipped.push(`${harnessRel}/${existing} (unrelated, preserved)`);
      continue;
    }
    if (!approved.has(existing)) {
      try {
        rmSync(skillDir, { recursive: true, force: true });
        counts.removed.push(`${harnessRel}/${existing}`);
      } catch (error) {
        counts.failed.push(
          `remove ${harnessRel}/${existing}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

function main(): number {
  const root = resolveRoot();
  const canonical = path.join(root, CANONICAL_SKILLS_DIR);
  if (!existsSync(canonical)) {
    console.error(`Missing canonical skills directory: ${CANONICAL_SKILLS_DIR}`);
    return 1;
  }

  const totals: Counts = {
    copied: [],
    updated: [],
    skipped: [],
    failed: [],
    removed: [],
  };

  for (const harness of HARNESS_SKILL_DIRS) {
    syncHarness(root, harness, totals);
  }

  console.log("skills:sync summary");
  console.log(`  copied:  ${totals.copied.length}`);
  console.log(`  updated: ${totals.updated.length}`);
  console.log(`  skipped: ${totals.skipped.length}`);
  console.log(`  removed: ${totals.removed.length}`);
  console.log(`  failed:  ${totals.failed.length}`);
  if (totals.copied.length) {
    for (const item of totals.copied) console.log(`  + ${item}`);
  }
  if (totals.updated.length) {
    for (const item of totals.updated) console.log(`  ~ ${item}`);
  }
  if (totals.skipped.length) {
    for (const item of totals.skipped) console.log(`  = ${item}`);
  }
  if (totals.removed.length) {
    for (const item of totals.removed) console.log(`  - ${item}`);
  }
  if (totals.failed.length) {
    for (const item of totals.failed) console.error(`  ! ${item}`);
    return 1;
  }
  return 0;
}

process.exit(main());
