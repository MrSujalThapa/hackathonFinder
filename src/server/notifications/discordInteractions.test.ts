import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyDiscordRequest } from "@/server/notifications/discordInteractions";
test("Discord interaction signatures reject unsigned and malformed requests", () => {
  assert.equal(verifyDiscordRequest(null, "1", "{}", "a".repeat(64)), false);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const body = "{\"type\":1}"; const timestamp = "123";
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  assert.equal(verifyDiscordRequest(signature, timestamp, body, der.subarray(-32).toString("hex")), true);
  assert.equal(verifyDiscordRequest(signature, timestamp, "{}", der.subarray(-32).toString("hex")), false);
});
