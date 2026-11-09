// Zenod testers program (ZAL-A13): the zenod.dev/testers apply form posts here.
// Answers go to a private file on the production data volume, never to a repo
// or a public page; agents read it on the server to pick the first 10 by hand.
// Spam-safe without cookies: a honeypot field, a per-address limit kept only in
// memory, and a daily ceiling.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";

export const TESTER_APPLICATIONS_FILE = "tester-applications.jsonl";
const USE_MIN = 10;
const USE_MAX = 2000;
const CONTACT_MIN = 3;
const CONTACT_MAX = 200;
const PER_ADDRESS_PER_HOUR = 5;
const PER_DAY = 300;

export interface TesterApplicationOptions {
  dataDir: string;
  clientAddress: (c: { req: { header(name: string): string | undefined }; env?: unknown }) => string;
  now?: () => Date;
}

export interface TesterApplication {
  at: string;
  use: string;
  contact: string;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max + 1) : "";
}

export function mountTesterApplications(app: Hono<{ Bindings: HttpBindings }>, options: TesterApplicationOptions): void {
  const now = options.now ?? (() => new Date());
  const path = join(options.dataDir, TESTER_APPLICATIONS_FILE);
  const recent = new Map<string, number[]>();
  let day = "";
  let dayCount = 0;

  app.post("/api/public/testers/apply", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid request" }, 400);
    // Honeypot: people never see this field; bots fill it. Answer as if kept.
    if (clean(body.website, 200)) return c.json({ ok: true });
    const use = clean(body.use, USE_MAX);
    const contact = clean(body.contact, CONTACT_MAX);
    if (use.length < USE_MIN || use.length > USE_MAX) {
      return c.json({ error: "Tell us in a sentence or two how you would use Zenod Memory." }, 400);
    }
    if (contact.length < CONTACT_MIN || contact.length > CONTACT_MAX) {
      return c.json({ error: "Leave an email or a handle we can reach you on." }, 400);
    }

    const at = now();
    const today = at.toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      dayCount = 0;
    }
    const address = options.clientAddress(c);
    const hourAgo = at.getTime() - 60 * 60 * 1000;
    const times = (recent.get(address) ?? []).filter((time) => time > hourAgo);
    if (times.length >= PER_ADDRESS_PER_HOUR || dayCount >= PER_DAY) {
      c.header("Retry-After", "3600");
      return c.json({ error: "Too many applications from here. Please try again later." }, 429);
    }
    times.push(at.getTime());
    recent.set(address, times);
    if (recent.size > 5000) recent.clear();
    dayCount += 1;

    const record: TesterApplication = { at: at.toISOString(), use, contact };
    try {
      mkdirSync(options.dataDir, { recursive: true });
      appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.error("[testers] could not keep an application:", error instanceof Error ? error.message : String(error));
      return c.json({ error: "Could not save your application. Please try again." }, 500);
    }
    console.log("[testers] application kept");
    return c.json({ ok: true });
  });
}
