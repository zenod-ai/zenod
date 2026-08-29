import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { customerUserId } from "../src/customerIdentity.js";
import { issueCustomerSession, readCustomerSession } from "../src/customerSession.js";

const env = { NODE_ENV: "test", ACCOUNT_STATE_SECRET: "session-test-secret" };

function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0]!;
}

describe("provider-neutral customer sessions", () => {
  it("issues a session whose owner key is the internal user id", async () => {
    const app = new Hono();
    app.get("/issue", (c) => {
      issueCustomerSession(c, {
        user_id: customerUserId("google", "google-sub-1"),
        provider: "google",
        provider_subject: "google-sub-1",
        display_name: "Ada",
        avatar_url: "https://example.test/ada.png",
        email: "ada@example.test",
        email_verified: true,
        github_id: null,
        github_login: null,
      }, env);
      return c.text("ok");
    });
    app.get("/read", (c) => c.json(readCustomerSession(c, env)));

    const issued = await app.request("/issue");
    const read = await app.request("/read", { headers: { cookie: cookieValue(issued.headers.get("set-cookie")!) } });
    const session = await read.json();
    expect(session).toEqual({
      user_id: customerUserId("google", "google-sub-1"),
      provider: "google",
      provider_subject: "google-sub-1",
      display_name: "Ada",
      avatar_url: "https://example.test/ada.png",
      login: "Ada",
    });
    expect(session).not.toHaveProperty("github_id");
  });

  it("reads a valid legacy GitHub cookie into the stable internal user id", async () => {
    const body = Buffer.from(JSON.stringify({
      github_id: 42,
      login: "octocat",
      exp: Date.now() + 60_000,
    })).toString("base64url");
    const mac = createHmac("sha256", env.ACCOUNT_STATE_SECRET).update(body).digest("base64url");
    const app = new Hono();
    app.get("/read", (c) => c.json(readCustomerSession(c, env)));

    const response = await app.request("/read", {
      headers: { cookie: `zenod_customer_session=${body}.${mac}` },
    });
    expect(await response.json()).toEqual({
      user_id: customerUserId("github", "42"),
      provider: "github",
      provider_subject: "42",
      display_name: "octocat",
      avatar_url: "https://github.com/octocat.png",
      github_id: 42,
      login: "octocat",
    });
  });
});
