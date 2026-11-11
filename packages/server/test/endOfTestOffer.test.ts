import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  endOfTestOffer,
  firstChargeAt,
  offerMail,
  offerMailerFromEnv,
  signedOfferUrl,
  verifyOfferLink,
} from "../src/endOfTestOffer.js";
import type { ZenodMail } from "../src/zenodMail.js";

const END = 1_800_000_000;
function sub(status: Stripe.Subscription.Status, metadata: Record<string, string>, cancelAtEnd = true): Stripe.Subscription {
  return { id: "sub_t", status, cancel_at_period_end: cancelAtEnd, current_period_end: END, ended_at: null, metadata } as unknown as Stripe.Subscription;
}

describe("end-of-test offer (EPIC-26 S13)", () => {
  it("is offered only on a tester's free month that the team did not extend", () => {
    const ended = { zenod_tester: "1", zenod_tester_month_end: "ended_free_time" };
    expect(endOfTestOffer(sub("active", ended))).toEqual({ phase: "before", freeEndsMs: END * 1000 });
    expect(endOfTestOffer(sub("canceled", ended))).toEqual({ phase: "after", freeEndsMs: END * 1000 });
    expect(endOfTestOffer(sub("active", { zenod_tester: "1", zenod_tester_month_end: "extended_by_us" }, false))).toBeNull();
    expect(endOfTestOffer(sub("active", { zenod_tester: "1" }, false))).toBeNull();
    expect(endOfTestOffer(sub("active", { zenod_tester_month_end: "ended_free_time" }))).toBeNull();
    expect(endOfTestOffer(sub("past_due", ended))).toBeNull();
  });

  it("charges the first €9 when the free month ends, never sooner than Stripe allows", () => {
    const now = END * 1000 - 5 * 86_400_000;
    expect(firstChargeAt({ phase: "before", freeEndsMs: END * 1000 }, now)).toBe(END);
    const late = END * 1000 - 3_600_000;
    expect(firstChargeAt({ phase: "before", freeEndsMs: END * 1000 }, late)).toBe(Math.ceil((late + 49 * 3_600_000) / 1000));
    expect(firstChargeAt({ phase: "after", freeEndsMs: END * 1000 }, now)).toBeNull();
  });

  it("signs the email's link for one account until it expires", () => {
    const url = new URL(signedOfferUrl("https://cloud.zenod.dev/", "acct_1", 2_000, "secret"));
    expect(url.origin + url.pathname).toBe("https://cloud.zenod.dev/keep-zenod");
    const q = Object.fromEntries(url.searchParams) as { a: string; e: string; s: string };
    expect(verifyOfferLink(q, "secret", 1_000)).toBe("acct_1");
    expect(verifyOfferLink(q, "secret", 3_000)).toBeNull();
    expect(verifyOfferLink({ ...q, a: "acct_2" }, "secret", 1_000)).toBeNull();
    expect(verifyOfferLink({ ...q, e: "9999999" }, "secret", 1_000)).toBeNull();
    expect(verifyOfferLink(q, "other", 1_000)).toBeNull();
    expect(verifyOfferLink(q, "", 1_000)).toBeNull();
  });

  it("says what they keep, what €9 gives, one button, and that nothing breaks if they do not pay", () => {
    const mail = offerMail("t@example.com", { freeEndsMs: Date.UTC(2026, 11, 3), payUrl: "https://cloud.zenod.dev/keep-zenod?a=x&e=1&s=y" });
    expect(mail.subject).toBe("Your free Zenod month ends on 3 December");
    expect(mail.text).toContain("Your notes stay yours. They live in your own Google Drive or GitHub repository");
    expect(mail.text).toContain("Hosted is €9 a month plus VAT");
    expect(mail.text).toContain("Keep Zenod for €9 a month: https://cloud.zenod.dev/keep-zenod?a=x&e=1&s=y");
    expect(mail.text).toContain("Nothing is charged before 3 December.");
    expect(mail.text).toContain("If you do not pay, nothing breaks.");
    expect(mail.html).toContain('href="https://cloud.zenod.dev/keep-zenod?a=x&#38;e=1&#38;s=y"');
  });

  describe("the offer email's queue", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "zenod-offer-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("stays off without the welcome mail's switch and key", () => {
      const mailer = offerMailerFromEnv(dir, {}, async () => undefined);
      expect(mailer.queue("sub_t:1", "t@example.com")).toBe("off");
      const half = offerMailerFromEnv(dir, { ZENOD_WELCOME_MAIL: "1" }, async () => undefined);
      expect(half.queue("sub_t:1", "t@example.com")).toBe("off");
    });

    it("sends the offer once per free month when the switch and key are set", async () => {
      const sent: ZenodMail[] = [];
      const mailer = offerMailerFromEnv(dir, { ZENOD_WELCOME_MAIL: "1", GOOGLE_MAIL_SERVICE_ACCOUNT_JSON: "{}" }, async (mail) => {
        sent.push(mail);
      });
      const data = { free_ends_ms: String(Date.UTC(2026, 11, 3)), pay_url: "https://cloud.zenod.dev/keep-zenod?a=x" };
      expect(mailer.queue("sub_t:1", "t@example.com", data)).toBe("queued");
      expect(mailer.queue("sub_t:1", "t@example.com", data)).toBe("duplicate");
      await mailer.process();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "t@example.com", subject: "Your free Zenod month ends on 3 December" });
      expect(sent[0]!.text).toContain("https://cloud.zenod.dev/keep-zenod?a=x");
    });
  });
});
