// EPIC-24 M2: the cloud app reports its own errors here (a script error, an unhandled rejection, a failed
// API call), so the health page sees what a person sees in the browser. Only the error class, a route
// template and an HTTP status are kept, as one `[ops-alert] app ...` log line: no message text, no stack,
// no ids. Public (the sign-in page fails too); a per-address limit and a daily ceiling keep it cheap.
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { opsAlert } from "./opsAlert.js";

const PER_ADDRESS_PER_10_MIN = 20;
const PER_DAY = 2000;
const KINDS = new Set(["error", "rejection", "api", "network", "staged"]);

export interface ClientErrorOptions {
  clientAddress: (c: { req: { header(name: string): string | undefined }; env?: unknown }) => string;
  now?: () => Date;
}

/** `/app/memory/3f2a…/x` → `/app/memory/:id/x`: segments with digits or longer than 24 characters become `:id`. */
export function routeTemplate(value: unknown): string {
  const path = typeof value === "string" ? value.split(/[?#]/)[0] ?? "" : "";
  if (!path.startsWith("/")) return "/";
  return "/" + path.split("/").filter(Boolean).slice(0, 4)
    .map((s) => (/\d/.test(s) || s.length > 24 || /[^A-Za-z0-9_.-]/.test(s) ? ":id" : s))
    .join("/");
}

/** An error class name like `TypeError` or `ApiError`; anything else becomes `Error`. */
function className(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) ? value : "Error";
}

export function mountClientErrorReports(app: Hono<{ Bindings: HttpBindings }>, options: ClientErrorOptions): void {
  const now = options.now ?? (() => new Date());
  const recent = new Map<string, number[]>();
  let day = "";
  let dayCount = 0;

  app.post("/api/public/client-error", bodyLimit({ maxSize: 2 * 1024 }), async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid request" }, 400);
    const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
    if (!kind) return c.json({ error: "invalid request" }, 400);

    const at = now();
    const today = at.toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      dayCount = 0;
    }
    const address = options.clientAddress(c);
    const cut = at.getTime() - 10 * 60 * 1000;
    const times = (recent.get(address) ?? []).filter((t) => t > cut);
    if (times.length >= PER_ADDRESS_PER_10_MIN || dayCount >= PER_DAY) return c.body(null, 204);
    times.push(at.getTime());
    recent.set(address, times);
    if (recent.size > 5000) recent.clear();
    dayCount += 1;

    const status = Number(body.status);
    opsAlert("app", `client_${kind}`, {
      name: className(body.name),
      page: routeTemplate(body.page),
      api: body.api === undefined ? undefined : routeTemplate(body.api),
      status: Number.isInteger(status) && status >= 0 && status < 600 ? status : undefined,
    });
    return c.body(null, 204);
  });
}
