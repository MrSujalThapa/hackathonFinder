/**
 * Verify a password against the configured owner hash (same path as production login).
 * Prints only MATCH or NO MATCH.
 */
import { loadLocalEnv } from "../src/cli/loadEnv";
import {
  resolveOwnerPasswordHash,
  verifyOwnerPassword,
} from "../src/lib/auth/password";

loadLocalEnv();

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run verify:password -- "your-long-password"');
  process.exit(1);
}

try {
  const resolved = resolveOwnerPasswordHash({
    APP_OWNER_PASSWORD_HASH_B64: process.env.APP_OWNER_PASSWORD_HASH_B64,
    APP_OWNER_PASSWORD_HASH: process.env.APP_OWNER_PASSWORD_HASH,
  });
  if (!resolved) {
    console.log("NO MATCH");
    process.exit(1);
  }
  const ok = verifyOwnerPassword(password, resolved.hash);
  console.log(ok ? "MATCH" : "NO MATCH");
  process.exit(ok ? 0 : 1);
} catch {
  console.log("NO MATCH");
  process.exit(1);
}
