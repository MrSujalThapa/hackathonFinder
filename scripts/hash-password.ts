import { hashOwnerPassword } from "../src/lib/auth/password";

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash:password -- "your-long-password"');
  process.exit(1);
}

try {
  console.log(hashOwnerPassword(password));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to hash password");
  process.exit(1);
}
