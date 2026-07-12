import {
  encodeOwnerPasswordHashB64,
  hashOwnerPassword,
} from "../src/lib/auth/password";

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash:password -- "your-long-password"');
  process.exit(1);
}

try {
  const encoded = hashOwnerPassword(password);
  const b64 = encodeOwnerPasswordHashB64(encoded);
  // Never print plaintext. Only emit the env-safe value.
  console.log(`APP_OWNER_PASSWORD_HASH_B64=${b64}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to hash password");
  process.exit(1);
}
