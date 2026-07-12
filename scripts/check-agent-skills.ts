/**
 * Validate canonical approved skills and harness copies.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  APPROVED_SKILL_NAMES,
  APPROVED_SKILLS,
  CANONICAL_SKILLS_DIR,
  GENERATED_MARKER,
  HARNESS_SKILL_DIRS,
  type ApprovedSkill,
} from "./agent-skills-manifest";

type SourceJson = {
  name: string;
  sourceRepository: string;
  sourcePath: string;
  sourceCommit: string;
  license: string;
  vendoredAt: string;
  scriptHashes?: Record<string, string>;
};

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

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

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Recursively list relative file paths (posix), excluding generated marker. */
function listFilesRelative(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === GENERATED_MARKER) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFilesRelative(full, base));
    } else {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

function assertSourceMetadata(
  skill: ApprovedSkill,
  skillDir: string,
): SourceJson | null {
  const sourcePath = path.join(skillDir, "SOURCE.json");
  if (!existsSync(sourcePath)) {
    fail(`${skill.name}: missing SOURCE.json`);
    return null;
  }
  let parsed: SourceJson;
  try {
    parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as SourceJson;
  } catch {
    fail(`${skill.name}: SOURCE.json is not valid JSON`);
    return null;
  }
  if (parsed.name !== skill.name) {
    fail(`${skill.name}: SOURCE.json name mismatch (${parsed.name})`);
  }
  if (parsed.sourceRepository !== skill.sourceRepository) {
    fail(`${skill.name}: SOURCE.json sourceRepository mismatch`);
  }
  if (parsed.sourcePath !== skill.sourcePath) {
    fail(`${skill.name}: SOURCE.json sourcePath mismatch`);
  }
  if (parsed.sourceCommit !== skill.sourceCommit) {
    fail(`${skill.name}: SOURCE.json sourceCommit mismatch`);
  }
  if (parsed.license !== skill.license) {
    fail(`${skill.name}: SOURCE.json license mismatch`);
  }
  if (!parsed.vendoredAt) {
    fail(`${skill.name}: SOURCE.json missing vendoredAt`);
  }
  return parsed;
}

function assertRequiredFiles(skill: ApprovedSkill, skillDir: string): void {
  for (const rel of skill.requiredFiles) {
    if (!existsSync(path.join(skillDir, rel))) {
      fail(`${skill.name}: missing required file ${rel}`);
    }
  }
}

function assertScriptHashes(
  skill: ApprovedSkill,
  skillDir: string,
  source: SourceJson | null,
): void {
  if (!skill.hashedScripts?.length) return;
  if (!source?.scriptHashes) {
    fail(`${skill.name}: missing scriptHashes in SOURCE.json`);
    return;
  }
  for (const rel of skill.hashedScripts) {
    const full = path.join(skillDir, rel);
    if (!existsSync(full)) {
      fail(`${skill.name}: hashed script missing ${rel}`);
      continue;
    }
    const expected = source.scriptHashes[rel];
    if (!expected) {
      fail(`${skill.name}: no pinned hash for ${rel}`);
      continue;
    }
    const actual = sha256File(full);
    if (actual !== expected) {
      fail(
        `${skill.name}: script hash changed for ${rel} (expected ${expected}, got ${actual})`,
      );
    }
  }
}

function assertHarnessCopy(
  root: string,
  skill: ApprovedSkill,
  harnessRel: string,
): void {
  const canonicalDir = path.join(root, CANONICAL_SKILLS_DIR, skill.name);
  const destDir = path.join(root, harnessRel, skill.name);
  if (!existsSync(destDir)) {
    fail(`${harnessRel}/${skill.name}: missing harness copy (run skills:sync)`);
    return;
  }
  if (!existsSync(path.join(destDir, GENERATED_MARKER))) {
    fail(`${harnessRel}/${skill.name}: missing generated marker`);
  }

  const canonicalFiles = listFilesRelative(canonicalDir);
  const harnessFiles = listFilesRelative(destDir);
  if (canonicalFiles.join("\n") !== harnessFiles.join("\n")) {
    fail(
      `${harnessRel}/${skill.name}: file list differs from canonical (re-run skills:sync)`,
    );
    return;
  }
  for (const rel of canonicalFiles) {
    const a = readFileSync(path.join(canonicalDir, rel));
    const b = readFileSync(path.join(destDir, rel));
    if (!a.equals(b)) {
      fail(
        `${harnessRel}/${skill.name}: content mismatch for ${rel} (re-run skills:sync)`,
      );
    }
  }
}

function main(): number {
  const root = resolveRoot();
  const canonicalRoot = path.join(root, CANONICAL_SKILLS_DIR);
  if (!existsSync(canonicalRoot)) {
    fail(`Missing ${CANONICAL_SKILLS_DIR}`);
    console.error(errors.join("\n"));
    return 1;
  }

  const present = listDirs(canonicalRoot);
  const approved = new Set(APPROVED_SKILL_NAMES);

  for (const name of present) {
    if (!approved.has(name)) {
      fail(`unexpected canonical skill vendored: ${name}`);
    }
  }

  for (const skill of APPROVED_SKILLS) {
    const skillDir = path.join(canonicalRoot, skill.name);
    if (!existsSync(skillDir)) {
      fail(`missing approved skill folder: ${skill.name}`);
      continue;
    }
    assertRequiredFiles(skill, skillDir);
    const source = assertSourceMetadata(skill, skillDir);
    assertScriptHashes(skill, skillDir, source);

    for (const harness of HARNESS_SKILL_DIRS) {
      assertHarnessCopy(root, skill, harness);
    }
  }

  if (errors.length) {
    console.error("skills:check FAILED");
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }

  console.log("skills:check OK");
  console.log(`  approved skills: ${APPROVED_SKILLS.length}`);
  console.log(`  harnesses: ${HARNESS_SKILL_DIRS.join(", ")}`);
  return 0;
}

process.exit(main());
