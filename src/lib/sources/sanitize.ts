/**
 * Sanitize diagnostic / error text for client and CLI output.
 * Never leak API keys, cookies, bearer tokens, or browser profile paths.
 */
import { redactProfilePaths, resolveHakkuProfileDir } from "@/lib/browser/profilePaths";

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /api[_-]?key[=:\s]+[^\s"'&,;]+/gi,
  /authorization[=:\s]+[^\s"'&,;]+/gi,
  /cookie[=:\s]+[^\s]+/gi,
  /scrypt\$[^\s]+/gi,
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
];

export function sanitizeDiagnosticMessage(message: string): string {
  let out = message;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }

  try {
    const profileDir = resolveHakkuProfileDir();
    out = redactProfilePaths(out, profileDir);
  } catch {
    // ignore invalid profile name config
  }

  // Generic absolute path redaction for browser-profiles segments
  out = out.replace(
    /[A-Za-z]:\\[^\s]*browser-profiles[^\s]*/gi,
    "[browser-profile]",
  );
  out = out.replace(/\/[^\s]*browser-profiles[^\s]*/gi, "[browser-profile]");

  return out.slice(0, 400);
}
