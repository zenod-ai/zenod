import { describe, expect, it } from "vitest";
import { submitTesterApplication } from "./testers";

const answer = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("testers apply form (EPIC-26 S2)", () => {
  it("returns accepted or waitlist from the server", async () => {
    const input = { use: "Voice notes on my walks", contact: "me@example.com", website: "" };
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "accepted" }))).toBe("accepted");
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "waitlist" }))).toBe("waitlist");
    expect(await submitTesterApplication(input, answer(200, { ok: true }))).toBeNull();
  });

  it("shows the server's words when it refuses", async () => {
    await expect(
      submitTesterApplication({ use: "x", contact: "u/name", website: "" }, answer(400, { error: "Leave your email, so we can send you your link." })),
    ).rejects.toThrow("Leave your email");
  });
});
