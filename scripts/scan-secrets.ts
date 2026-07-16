/**
 * Lightweight development-only secret scan of tracked files.
 * Reports path + pattern type only — never prints matched secret values.
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";

type Finding = {
  path: string;
  type: string;
  remediation: string;
};

const MAX_FILE_BYTES = 1_500_000;

const PATTERNS: Array<{ type: string; regex: RegExp; remediation: string }> = [
  {
    type: "openai_api_key",
    regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    remediation: "Remove from tree, rotate key, consider history cleanup.",
  },
  {
    type: "google_api_key",
    regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g,
    remediation: "Remove from tree, rotate key, consider history cleanup.",
  },
  {
    type: "private_key_block",
    regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    remediation: "Remove key material; use env vars; rotate if ever committed.",
  },
  {
    type: "supabase_service_role_jwt_like",
    regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    remediation: "Ensure JWTs are placeholders only; rotate if real.",
  },
  {
    type: "tavily_key",
    regex: /\btvly-[a-zA-Z0-9]{20,}\b/g,
    remediation: "Remove and rotate search API key.",
  },
  {
    type: "env_assignment_secret",
    regex:
      /\b(SUPABASE_SERVICE_ROLE_KEY|LLM_API_KEY|SEARCH_API_KEY|X_BEARER_TOKEN|APP_PASSWORD|APP_SESSION_SECRET|GOOGLE_SERVICE_ACCOUNT_JSON|WORKER_SHARED_SECRET)\s*=\s*(["'])([^"'\\\n]{12,})\2/gi,
    remediation: "Replace with placeholders in examples; keep real values in gitignored .env.local only.",
  },
];

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUE.test(value.trim());
}
const SKIP_PATH_PARTS = [
  "node_modules/",
  ".next/",
  ".git/",
  "package-lock.json",
  "LICENSE",
  ".agents/skills/",
  ".claude/skills/",
  ".codex/skills/",
  ".cursor/skills/",
];

const SKIP_FILE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".example",
];

const PLACEHOLDER_VALUE =
  /^(change-me|your-|replace|placeholder|<|example|fake|dummy|test-|secret-token|dev-password|x{8,}|d{8,}|b{8,}|["']?\.\.\.?["']?)/i;

function listTrackedFiles(): string[] {
  const out = execSync("git ls-files -z", { encoding: "buffer" });
  return out
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => !SKIP_PATH_PARTS.some((part) => path.includes(part)))
    .filter((path) => !SKIP_FILE_SUFFIXES.some((suffix) => path.endsWith(suffix)));
}

function scanFile(path: string): Finding[] {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return [];
  }
  if (size > MAX_FILE_BYTES) return [];
  if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|pdf|mp4|zip)$/i.test(path)) {
    return [];
  }

  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  // Skip this scanner's own pattern source and obvious fixtures.
  if (path.replace(/\\/g, "/").endsWith("scripts/scan-secrets.ts")) {
    return [];
  }

  const findings: Finding[] = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.type === "env_assignment_secret") {
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(content)) !== null) {
        const value = match[3] ?? "";
        if (looksLikePlaceholder(value)) continue;
        findings.push({
          path: relative(process.cwd(), path).replace(/\\/g, "/"),
          type: pattern.type,
          remediation: pattern.remediation,
        });
        break;
      }
      continue;
    }
    if (pattern.regex.test(content)) {
      findings.push({
        path: relative(process.cwd(), path).replace(/\\/g, "/"),
        type: pattern.type,
        remediation: pattern.remediation,
      });
    }
  }
  return findings;
}

function main(): number {
  console.log("=== Secret scan (tracked files) ===\n");
  const files = listTrackedFiles();
  const findings = files.flatMap(scanFile);

  if (findings.length === 0) {
    console.log(`Scanned ${files.length} tracked files.`);
    console.log("RESULT: OK (no high-confidence secret patterns)");
    return 0;
  }

  console.log(`Scanned ${files.length} tracked files.`);
  console.log(`Findings: ${findings.length}\n`);
  for (const finding of findings) {
    console.log(`- path: ${finding.path}`);
    console.log(`  type: ${finding.type}`);
    console.log(`  tracked: yes`);
    console.log(`  remediation: ${finding.remediation}`);
  }
  console.log("\nRESULT: REVIEW_REQUIRED");
  console.log("Values are not printed. Rotate any real credentials immediately.");
  return 1;
}

process.exitCode = main();
