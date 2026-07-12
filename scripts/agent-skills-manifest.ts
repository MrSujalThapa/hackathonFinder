/**
 * Canonical approved agent skills for this repository.
 * Used by skills:sync and skills:check.
 */
export type ApprovedSkill = {
  name: string;
  sourceRepository: string;
  sourcePath: string;
  sourceCommit: string;
  license: string;
  /** Relative paths that must exist under the skill folder. */
  requiredFiles: string[];
  /** Optional executable scripts whose hashes are pinned in SOURCE.json. */
  hashedScripts?: string[];
};

export const APPROVED_SKILLS: ApprovedSkill[] = [
  {
    name: "impeccable",
    sourceRepository: "https://github.com/bergside/awesome-design-skills",
    sourcePath: "skills/impeccable",
    sourceCommit: "f631a09b4fcc0166f2e2c1a8c81906ef680c57e8",
    license: "MIT",
    requiredFiles: ["SKILL.md", "DESIGN.md", "LICENSE", "SOURCE.json"],
  },
  {
    name: "editorial",
    sourceRepository: "https://github.com/bergside/awesome-design-skills",
    sourcePath: "skills/editorial",
    sourceCommit: "f631a09b4fcc0166f2e2c1a8c81906ef680c57e8",
    license: "MIT",
    requiredFiles: ["SKILL.md", "DESIGN.md", "LICENSE", "SOURCE.json"],
  },
  {
    name: "clean",
    sourceRepository: "https://github.com/bergside/awesome-design-skills",
    sourcePath: "skills/clean",
    sourceCommit: "f631a09b4fcc0166f2e2c1a8c81906ef680c57e8",
    license: "MIT",
    requiredFiles: ["SKILL.md", "DESIGN.md", "LICENSE", "SOURCE.json"],
  },
  {
    name: "gsap-core",
    sourceRepository: "https://github.com/greensock/gsap-skills",
    sourcePath: "skills/gsap-core",
    sourceCommit: "aed9cfd3277740755f6bfc1155c7aa645403b760",
    license: "MIT",
    requiredFiles: ["SKILL.md", "LICENSE", "SOURCE.json"],
  },
  {
    name: "gsap-react",
    sourceRepository: "https://github.com/greensock/gsap-skills",
    sourcePath: "skills/gsap-react",
    sourceCommit: "aed9cfd3277740755f6bfc1155c7aa645403b760",
    license: "MIT",
    requiredFiles: ["SKILL.md", "LICENSE", "SOURCE.json"],
  },
  {
    name: "gsap-timeline",
    sourceRepository: "https://github.com/greensock/gsap-skills",
    sourcePath: "skills/gsap-timeline",
    sourceCommit: "aed9cfd3277740755f6bfc1155c7aa645403b760",
    license: "MIT",
    requiredFiles: ["SKILL.md", "LICENSE", "SOURCE.json"],
  },
  {
    name: "gsap-performance",
    sourceRepository: "https://github.com/greensock/gsap-skills",
    sourcePath: "skills/gsap-performance",
    sourceCommit: "aed9cfd3277740755f6bfc1155c7aa645403b760",
    license: "MIT",
    requiredFiles: ["SKILL.md", "LICENSE", "SOURCE.json"],
  },
  {
    name: "webapp-testing",
    sourceRepository: "https://github.com/ComposioHQ/awesome-codex-skills",
    sourcePath: "webapp-testing",
    sourceCommit: "9c9da64cf1bbea611d43dd14a10788d55369b353",
    license: "Apache-2.0",
    requiredFiles: [
      "SKILL.md",
      "LICENSE.txt",
      "SOURCE.json",
      "SCRIPT_AUDIT.md",
      "scripts/with_server.py",
      "examples/console_logging.py",
      "examples/element_discovery.py",
      "examples/static_html_automation.py",
    ],
    hashedScripts: [
      "scripts/with_server.py",
      "examples/console_logging.py",
      "examples/element_discovery.py",
      "examples/static_html_automation.py",
    ],
  },
];

export const APPROVED_SKILL_NAMES = APPROVED_SKILLS.map((s) => s.name);

export const CANONICAL_SKILLS_DIR = ".agents/skills";

export const HARNESS_SKILL_DIRS = [
  ".cursor/skills",
  ".codex/skills",
  ".claude/skills",
] as const;

/** Marker written only into harness copies (never into canonical). */
export const GENERATED_MARKER = ".skill-sync-generated.json";
