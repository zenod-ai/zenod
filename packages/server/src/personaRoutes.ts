import type { Context, Hono } from "hono";
import { personaById, BUILT_IN_PERSONAS } from "./personaCatalog.js";
import { helpersBuilding, parsePersonaSchedule, PERSONA_MAX_EVERY_DAYS, PERSONA_MIN_EVERY_DAYS, PERSONA_SKILLS, PERSONA_TOTAL_MONTH_USD, personaEnabled, personaView, type PersonaDefinition } from "./personaRunner.js";
import { personasFor, type PersonaRun } from "./personaStore.js";
import { opsAlert } from "./opsAlert.js";
import { markQuickStart } from "./quickStart.js";

/**
 * The personas' settings routes (EPIC-14 S4): the catalog with each persona's skills, last runs and
 * spend; switch one on or off and set its cadence; and Run now (only while it is on). The tenant comes from the signed-in session only (`resolve`, as for the
 * inbox), so a persona's runs are read and started in that account's own runtime.
 */

export interface PersonaRuntime {
  readonly dataDir: string;
  /** EPIC-23 U7: the account's tenant, for the still-building rule. */
  readonly tenantId?: string;
  runPersona(persona: PersonaDefinition, trigger: "schedule" | "manual"): Promise<PersonaRun | null>;
  /** S35: whether a Team connection exists for helpers to ask. */
  teamAskAvailable?(): boolean;
}

export type PersonaResolve = (c: Context) => Promise<{ runtime: PersonaRuntime } | { response: Response }>;

function list(runtime: PersonaRuntime, now = new Date()) {
  const store = personasFor(runtime);
  const building = helpersBuilding(runtime.tenantId);
  // U7: while helpers are still building for this account, every one shows as off.
  const personas = BUILT_IN_PERSONAS.map((persona) => personaView(persona, store, now))
    .map((view) => (building ? { ...view, enabled: false, nextWakeAt: null } : view));
  return {
    building,
    personas,
    budget: { spentUsd: personas[0]?.budget.totalUsd ?? 0, capUsd: PERSONA_TOTAL_MONTH_USD },
    teamConnected: runtime.teamAskAvailable?.() ?? false,
    skills: Object.entries(PERSONA_SKILLS).map(([id, label]) => ({ id, label })),
  };
}

export function registerPersonaRoutes(app: Hono<any>, resolve: PersonaResolve): void {
  app.get("/api/console/personas", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    return c.json(list(found.runtime));
  });

  // Switch a persona on or off, and/or set its cadence (null: back to its default), and/or (S35)
  // whether it may ask the Team desk one question a run.
  app.post("/api/console/personas/:id", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const persona = personaById(c.req.param("id"));
    if (!persona) return c.json({ error: "not_found", message: "no such helper" }, 404);
    const body = await c.req.json<{ enabled?: unknown; cadence?: unknown; askTeam?: unknown }>().catch(() => ({}) as { enabled?: unknown; cadence?: unknown; askTeam?: unknown });
    if (helpersBuilding(found.runtime.tenantId)) return c.json({ error: "building", message: "Helpers are still being built" }, 409);
    if (body.enabled === undefined && body.cadence === undefined && body.askTeam === undefined) return c.json({ error: "invalid", message: "send enabled, cadence or askTeam" }, 400);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return c.json({ error: "invalid", message: "enabled must be true or false" }, 400);
    if (body.askTeam !== undefined && typeof body.askTeam !== "boolean") return c.json({ error: "invalid", message: "askTeam must be true or false" }, 400);
    if (body.askTeam === true && !persona.asksTeam) return c.json({ error: "invalid", message: `${persona.name} cannot ask the team` }, 400);
    if (body.askTeam === true && !(found.runtime.teamAskAvailable?.() ?? false)) return c.json({ error: "conflict", message: "Connect your team first" }, 409);
    const cadence = body.cadence === undefined || body.cadence === null ? null : parsePersonaSchedule(body.cadence);
    if (body.cadence !== undefined && body.cadence !== null && !cadence) {
      return c.json({ error: "invalid", message: `cadence is daily, weekly or every ${PERSONA_MIN_EVERY_DAYS} to ${PERSONA_MAX_EVERY_DAYS} days` }, 400);
    }
    const store = personasFor(found.runtime);
    if (body.cadence !== undefined) store.setCadence(persona.id, cadence, persona.defaultEnabled);
    if (typeof body.enabled === "boolean") store.setEnabled(persona.id, body.enabled);
    // EPIC-26 S15: the quick start's step 5, kept even if the helper is switched off again.
    if (body.enabled === true) markQuickStart(found.runtime.dataDir, "helper", { helperName: persona.name });
    if (typeof body.askTeam === "boolean") store.setAskTeam(persona.id, body.askTeam, persona.defaultEnabled);
    return c.json(list(found.runtime));
  });

  // Run now: the same caps and log as a scheduled wake, without the nothing-new skip.
  app.post("/api/console/personas/:id/run", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const persona = personaById(c.req.param("id"));
    if (!persona) return c.json({ error: "not_found", message: "no such helper" }, 404);
    if (helpersBuilding(found.runtime.tenantId)) return c.json({ error: "building", message: "Helpers are still being built" }, 409);
    // A persona runs only while it is switched on.
    if (!personaEnabled(personasFor(found.runtime), persona)) {
      return c.json({ error: "conflict", message: `Switch ${persona.name} on first` }, 409);
    }
    if (personasFor(found.runtime).runs(persona.id, 1)[0]?.status === "running") {
      return c.json({ error: "conflict", message: `${persona.name} is already running` }, 409);
    }
    try {
      const run = await found.runtime.runPersona(persona, "manual");
      return c.json({ run, ...list(found.runtime) });
    } catch (error) {
      console.warn(`[persona] run now unavailable: ${error instanceof Error ? error.message : String(error)}`);
      opsAlert("helper", "run_unavailable", { helper: persona.id });
      return c.json({ error: "unavailable", message: "Your memory is not ready for helpers yet" }, 503);
    }
  });
}
