import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "./src/middleware";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

describe("middleware protection", () => {
  it("redirects unauthenticated protected pages to login", async () => {
    const response = await middleware(new NextRequest("http://localhost/queue"));
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /\/login/);
  });

  it("rejects unauthenticated protected APIs", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/candidates?status=NEW"),
    );
    assert.equal(response.status, 401);
  });

  it("allows authenticated protected pages", async () => {
    process.env.APP_SESSION_SECRET = "b".repeat(40);
    const token = await createSessionToken(process.env.APP_SESSION_SECRET);
    const request = new NextRequest("http://localhost/queue", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const response = await middleware(request);
    assert.equal(response.status, 200);
  });
});
