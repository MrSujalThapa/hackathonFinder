import path from "node:path";

export const DEFAULT_BROWSER_PROFILE_ROOT = ".data/browser-profiles";
export const DEFAULT_HAKKU_PROFILE_NAME = "hakku";

export type ProfilePathEnv = {
  BROWSER_PROFILE_ROOT?: string;
  HAKKU_PROFILE_NAME?: string;
  [key: string]: string | undefined;
};

/**
 * Resolve the browser profile root directory.
 * Relative roots are resolved against `cwd` so Windows and Linux both work
 * without hardcoded drive letters.
 */
export function resolveBrowserProfileRoot(
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const configured = env.BROWSER_PROFILE_ROOT?.trim();
  const root = configured && configured.length > 0 ? configured : DEFAULT_BROWSER_PROFILE_ROOT;
  return path.resolve(cwd, root);
}

export function resolveHakkuProfileName(env: ProfilePathEnv = process.env): string {
  const configured = env.HAKKU_PROFILE_NAME?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_HAKKU_PROFILE_NAME;
}

/** Absolute path to a named source profile directory under the profile root. */
export function resolveSourceProfileDir(
  sourceProfileName: string,
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const safeName = sourceProfileName.trim();
  if (!safeName || safeName.includes("..") || path.isAbsolute(safeName)) {
    throw new Error(`Invalid browser profile name: ${sourceProfileName}`);
  }
  if (/[\\/]/.test(safeName)) {
    throw new Error(`Invalid browser profile name: ${sourceProfileName}`);
  }
  return path.join(resolveBrowserProfileRoot(env, cwd), safeName);
}

export function resolveHakkuProfileDir(
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return resolveSourceProfileDir(resolveHakkuProfileName(env), env, cwd);
}

/** Sidecar status file kept next to profiles (not inside Chromium user-data). */
export function resolveSourceStatusPath(
  sourceProfileName: string,
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return path.join(resolveBrowserProfileRoot(env, cwd), ".status", `${sourceProfileName}.json`);
}

export function resolveHakkuStatusPath(
  env: ProfilePathEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return resolveSourceStatusPath(resolveHakkuProfileName(env), env, cwd);
}

/** Redact absolute profile paths from log/error text for safe diagnostics. */
export function redactProfilePaths(message: string, profileDir: string): string {
  if (!profileDir) return message;
  const variants = new Set<string>([profileDir, profileDir.replace(/\\/g, "/"), profileDir.replace(/\//g, "\\")]);
  let out = message;
  for (const variant of variants) {
    if (!variant) continue;
    out = out.split(variant).join("[browser-profile]");
  }
  return out;
}
