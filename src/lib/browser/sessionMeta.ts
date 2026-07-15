import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  resolveHakkuProfileDir,
  resolveHakkuProfileName,
  resolveHakkuStatusPath,
  resolveSourceProfileDir,
  resolveSourceStatusPath,
  type ProfilePathEnv,
} from "@/lib/browser/profilePaths";

export type SourceConnectionStatus =
  | "connected"
  | "reconnect_required"
  | "unknown"
  | "profile_missing";

export type SourceSessionMeta = {
  source: string;
  status: SourceConnectionStatus;
  lastVerifiedAt?: string;
  updatedAt: string;
};

export function readSourceSessionMeta(
  sourceProfileName: string,
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): SourceSessionMeta | null {
  const statusPath = resolveSourceStatusPath(sourceProfileName, env, cwd);
  if (!existsSync(statusPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statusPath, "utf8")) as SourceSessionMeta;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSourceSessionMeta(
  meta: SourceSessionMeta,
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): void {
  const statusPath = resolveSourceStatusPath(meta.source, env, cwd);
  mkdirSync(path.dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export function profileDirExists(
  sourceProfileName: string,
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): boolean {
  return existsSync(resolveSourceProfileDir(sourceProfileName, env, cwd));
}

export function removeOrArchiveSourceProfile(
  sourceProfileName: string,
  options: { archive?: boolean } = {},
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): { removed: boolean; archivedTo?: string } {
  const profileDir = resolveSourceProfileDir(sourceProfileName, env, cwd);
  const statusPath = resolveSourceStatusPath(sourceProfileName, env, cwd);
  let archivedTo: string | undefined;
  let removed = false;

  if (existsSync(profileDir)) {
    if (options.archive) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      archivedTo = `${profileDir}.archived-${stamp}`;
      renameSync(profileDir, archivedTo);
    } else {
      rmSync(profileDir, { recursive: true, force: true });
    }
    removed = true;
  }

  if (existsSync(statusPath)) {
    rmSync(statusPath, { force: true });
  }

  return { removed, archivedTo };
}

export function readHakkuSessionMeta(
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): SourceSessionMeta | null {
  return readSourceSessionMeta(resolveHakkuProfileName(env), env, cwd);
}

export function writeHakkuSessionMeta(
  status: SourceConnectionStatus,
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): SourceSessionMeta {
  const source = resolveHakkuProfileName(env);
  const now = new Date().toISOString();
  const meta: SourceSessionMeta = {
    source,
    status,
    updatedAt: now,
    lastVerifiedAt: status === "connected" || status === "reconnect_required" ? now : undefined,
  };
  // Preserve prior lastVerifiedAt when status is unknown and we already had one.
  const prior = readSourceSessionMeta(source, env, cwd);
  if (meta.lastVerifiedAt === undefined && prior?.lastVerifiedAt) {
    meta.lastVerifiedAt = prior.lastVerifiedAt;
  }
  writeSourceSessionMeta(meta, env, cwd);
  return meta;
}

export function hakkuProfileExists(
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): boolean {
  return existsSync(resolveHakkuProfileDir(env, cwd));
}

export function hakkuStatusPath(
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return resolveHakkuStatusPath(env, cwd);
}
