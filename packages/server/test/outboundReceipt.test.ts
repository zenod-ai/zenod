import { describe, expect, it } from "vitest";
import { parseOutboundReceipt, renderOutboundReceipt, renderApproveAffordance, scrubVendorNoise, tweetUrl } from "../src/outboundReceipt.js";

describe("parseOutboundReceipt — X (Twitter)", () => {
  it("derives a LIVE url from the connector's real post id (never a placeholder)", () => {
    const raw = JSON.stringify({ data: { id: "1811111111111111111", text: "hello" } });
    const receipt = parseOutboundReceipt("x", raw);
    expect(receipt.verified).toBe(true);
    expect(receipt.id).toBe("1811111111111111111");
    expect(receipt.url).toBe(tweetUrl("1811111111111111111"));
    const text = renderOutboundReceipt(receipt);
    expect(text).toContain("https://x.com/i/web/status/1811111111111111111");
    expect(text).not.toContain("would be here");
  });

  // Iteration-2 replay: the connector returned no id, yet the model rendered its own
  // "Posted: https://x.com/… (tweet ID would be here)" as a live URL. With render-from-
  // receipt there is NO id, so the ONLY text is a FAILED — no fabricated success.
  it("replays the iteration-2 fake-URL failure → FAILED, never a drafted success", () => {
    const receipt = parseOutboundReceipt("x", JSON.stringify({ status: "ok", note: "no id available" }));
    expect(receipt.verified).toBe(false);
    const text = renderOutboundReceipt(receipt);
    expect(text).toMatch(/^FAILED to send to X/);
    expect(text).toContain("Do NOT tell the user it was sent");
    expect(text).not.toContain("x.com/");
  });

  it("treats a connector error string as FAILED (no success dressing)", () => {
    const receipt = parseOutboundReceipt("x", "The X (Twitter) connector reported an error: 401 Unauthorized");
    expect(receipt.verified).toBe(false);
    expect(renderOutboundReceipt(receipt)).toMatch(/^FAILED to send to X/);
  });
});

describe("parseOutboundReceipt — Reddit", () => {
  it("recovers the live permalink from the connector payload", () => {
    const raw = JSON.stringify({ data: { url: "https://www.reddit.com/r/test/comments/abc123/hi/", id: "t3_abc123" } });
    const receipt = parseOutboundReceipt("reddit", raw);
    expect(receipt.verified).toBe(true);
    expect(receipt.url).toBe("https://www.reddit.com/r/test/comments/abc123/hi/");
    expect(renderOutboundReceipt(receipt)).toContain("reddit.com/r/test/comments/abc123");
  });

  it("finds a reddit url nested deeper in the response", () => {
    const raw = JSON.stringify({ response: { json: { data: { things: [{ data: { permalink: "https://reddit.com/r/x/comments/z9/" } }] } } } });
    const receipt = parseOutboundReceipt("reddit", raw);
    expect(receipt.verified).toBe(true);
    expect(receipt.url).toContain("reddit.com/r/x/comments/z9");
  });

  it("with no url or id → FAILED", () => {
    const receipt = parseOutboundReceipt("reddit", JSON.stringify({ ok: true }));
    expect(receipt.verified).toBe(false);
  });
});

describe("parseOutboundReceipt — email", () => {
  it("a message id is proof of send", () => {
    const receipt = parseOutboundReceipt("email", JSON.stringify({ data: { message_id: "<abc@mail>" } }));
    expect(receipt.verified).toBe(true);
    expect(receipt.id).toBe("<abc@mail>");
  });
  it("a plain 'sent' acknowledgement (no JSON) is accepted", () => {
    expect(parseOutboundReceipt("email", "Sent.").verified).toBe(true);
  });
  it("an unrelated blob is NOT accepted as a send", () => {
    expect(parseOutboundReceipt("email", JSON.stringify({ foo: "bar" })).verified).toBe(false);
  });
});

describe("renderApproveAffordance (I4-R1)", () => {
  it("is the honest 'post now' affordance, never a fabricated success", () => {
    const text = renderApproveAffordance("x");
    expect(text.toLowerCase()).toContain("no committed draft");
    expect(text.toLowerCase()).toContain("post now");
    expect(text.toLowerCase()).toContain("do not claim");
    expect(text).not.toContain("x.com/");
    expect(text).not.toMatch(/^Posted/);
  });
  it("names the channel when known and stays generic when not", () => {
    expect(renderApproveAffordance("reddit").toLowerCase()).toContain("reddit");
    expect(renderApproveAffordance()).toContain("Nothing was sent:");
  });
});

describe("scrubVendorNoise (E1-T3)", () => {
  it("removes upgrade/quota/vendor noise from user-facing reasons", () => {
    const noisy = "Upgrade to Plus for more. You have reached your monthly quota. Reddit via Composio failed: 429.";
    const clean = scrubVendorNoise(noisy);
    expect(clean.toLowerCase()).not.toContain("upgrade to plus");
    expect(clean.toLowerCase()).not.toContain("quota");
    expect(clean.toLowerCase()).not.toContain("composio");
    expect(clean).toContain("429");
  });
});
