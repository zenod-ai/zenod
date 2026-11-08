import type { Context, Hono } from "hono";
import { personaById, BUILT_IN_PERSONAS } from "./personaCatalog.js";
import { PERSONA_TOTAL_MONTH_USD, personaView, type PersonaDefinition } from "./personaRunner.js";
import { personasFor, type PersonaRun } from "./personaStore.js";

/**
 * The personas' settings routes (EPIC-14 S4): list them with their last runs and spend, switch one
 * on or off, and Run now. The tenant comes from the signed-in session only (`resolve`, as for the
 * inbox), so a persona's runs are read and started in that account's own runtime.
 */

export interface PersonaRuntime {
  readonly dataDir: string;
  runPersona(persona: PersonaDefinition, trigger: "schedule" | "manual"): Promise<PersonaRun | null>;
}

export type PersonaResolve = (c: Context) => Promise<{ runtime: PersonaRuntime } | { response: Response }>;

function list(runtime: PersonaRuntime, now = new Date()) {
  const store = personasFor(runtime);
  const personas = BUILT_IN_PERSONAS.map((persona) => personaView(persona, store, now));
  return {
    personas,
    budget: { spentUsd: personas[0]?.budget.totalUsd ?? 0, capUsd: PERSONA_TOTAL_MONTH_USD },
  };
}

export function registerPersonaRoutes(app: Hono<any>, resolve: PersonaResolve): void {
  app.get("/api/console/personas", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    return c.json(list(found.runtime));
  });

  // Switch a persona on or off.
  app.post("/api/console/personas/:id", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const persona = personaById(c.req.param("id"));
    if (!persona) return c.json({ error: "not_found", message: "no such persona" }, 404);
    const body = await c.req.json<{ enabled?: unknown }>().catch(() => ({}) as { enabled?: unknown });
    if (typeof body.enabled !== "boolean") return c.json({ error: "invalid", message: "enabled must be true or false" }, 400);
    personasFor(found.runtime).setEnabled(persona.id, body.enabled);
    return c.json(list(found.runtime));
  });

  // Run now: the same caps and log as a scheduled wake, without the nothing-new skip.
  app.post("/api/console/personas/:id/run", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const persona = personaById(c.req.param("id"));
    if (!persona) return c.json({ error: "not_found", message: "no such persona" }, 404);
    if (personasFor(found.runtime).runs(persona.id, 1)[0]?.status === "running") {
      return c.json({ error: "conflict", message: `${persona.name} is already running` }, 409);
    }
    try {
      const run = await found.runtime.runPersona(persona, "manual");
      return c.json({ run, ...list(found.runtime) });
    } catch (error) {
      console.warn(`[persona] run now unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "unavailable", message: "Your memory is not ready for personas yet" }, 503);
    }
  });
}
