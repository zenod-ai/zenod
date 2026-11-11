import { describe, expect, it } from "vitest";
import { submitTesterApplication } from "./testers";

const answer = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("testers apply form (EPIC-26 S2)", () => {
  it("returns accepted or waitlist from the server", async () => {
    const input = { use: "Voice notes on my walks", contact: "me@example.com", website: "" };
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "accepted" }))).toEqual({ status: "accepted", link: null });
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "waitlist" }))).toEqual({ status: "waitlist", link: null });
    expect(await submitTesterApplication(input, answer(200, { ok: true }))).toEqual({ status: null, link: null });
  });

  it("passes on the personal link to open now, only a Zenod join link (EPIC-23 U7)", async () => {
    const input = { use: "Voice notes on my walks", contact: "me@example.com", website: "" };
    const link = "https://cloud.zenod.dev/join?code=ZT-ABCD2345";
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "accepted", code: "ZT-ABCD2345", link }))).toEqual({ status: "accepted", link });
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "accepted", link: "https://evil.example/join?code=x" }))).toEqual({ status: "accepted", link: null });
  });

  it("shows the server's words when it refuses", async () => {
    await expect(
      submitTesterApplication({ use: "x", contact: "u/name", website: "" }, answer(400, { error: "Leave your email, so we can send you your link." })),
    ).rejects.toThrow("Leave your email");
  });
});
