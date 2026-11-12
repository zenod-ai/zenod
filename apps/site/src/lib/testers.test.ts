import { describe, expect, it } from "vitest";
import { fetchTesterLink, rememberedTester, rememberTester, submitTesterApplication } from "./testers";

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

  it("passes on the browser's private key and a repeat (E26-S11 iteration 4)", async () => {
    const input = { use: "Voice notes on my walks", contact: "me@example.com", website: "" };
    const claim = "abcdefghijklmnopqrstuvwxyz_-0123";
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "accepted", claim }))).toEqual({ status: "accepted", link: null, claim });
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "accepted", claim: "bad key!" }))).toEqual({ status: "accepted", link: null });
    expect(await submitTesterApplication(input, answer(200, { ok: true, status: "accepted", again: true }))).toEqual({ status: "accepted", link: null, again: true });
  });

  it("keeps only this browser's own link and key, and fetches the link with the key", async () => {
    const box = new Map<string, string>();
    const store = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) };
    const link = "https://cloud.zenod.dev/join?code=ZT-ABCD2345";
    const claim = "abcdefghijklmnopqrstuvwxyz_-0123";
    expect(rememberedTester(store)).toBeNull();
    rememberTester({ link, claim }, store);
    expect(rememberedTester(store)).toEqual({ link, claim });
    box.set("zenod.tester", JSON.stringify({ link: "https://evil.example/x", claim: "no" }));
    expect(rememberedTester(store)).toBeNull();
    expect(await fetchTesterLink(claim, answer(200, { ok: true, link }))).toBe(link);
    expect(await fetchTesterLink(claim, answer(200, { ok: true, link: null }))).toBeNull();
    expect(await fetchTesterLink(claim, answer(404, { error: "not found" }))).toBeNull();
  });
});
