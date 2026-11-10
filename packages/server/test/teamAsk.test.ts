import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubscriberStore } from "../src/subscribers.js";
import { switchOnTeamAskForConnected, TeamAskError, teamAskFor, teamAskUrl } from "../src/teamAsk.js";
import { PersonaStore } from "../src/personaStore.js";
import { SqliteCredentialVault } from "../src/credentialVault.js";

/** EPIC-14 S35: the helpers' one read-only question to the Team desk, signed like a voice-note delivery (agent_team E45-S5). */

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-teamask-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("asking the Team desk (S35)", () => {
  it("builds the ask URL from the connection's hook URL only", () => {
    expect(teamAskUrl("https://hooks.alpha9.io/api/hooks/zenod/zcn_abc")).toBe("https://hooks.alpha9.io/api/hooks/zenod/zcn_abc/ask");
    expect(teamAskUrl("https://hooks.alpha9.io/api/hooks/zenod/zcn_abc/")).toBe("https://hooks.alpha9.io/api/hooks/zenod/zcn_abc/ask");
    expect(teamAskUrl("https://example.com/webhook")).toBeNull();
    expect(teamAskUrl("https://hooks.alpha9.io/api/hooks/zenod/zcn_abc?x=1")).toBeNull();
    expect(teamAskUrl("not a url")).toBeNull();
  });

  it("signs each question with the connection's own secret and reads the answer", async () => {
    const store = new SubscriberStore(join(dir, "subscribers.sqlite"), new SqliteCredentialVault({ dataDir: dir, tenantId: "t", masterKey: "1".repeat(64) }));
    expect(teamAskFor(store)).toBeNull();
    store.create({ name: "Webhook", kind: "webhook", url: "https://example.com/hook", event: "voice_note.captured", via: "manual" });
    expect(teamAskFor(store)).toBeNull();
    const { subscription, signingSecret } = store.create({ name: "Epic Team", kind: "agent_team", url: "https://hooks.alpha9.io/api/hooks/zenod/zcn_abc", event: "voice_note.captured", via: "manual" });
    const seen: Array<{ url: string; body: string; signature: string }> = [];
    const team = teamAskFor(store, {
      now: () => 1_700_000_000_000,
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, body: String(init.body), signature: String((init.headers as Record<string, string>)["x-zenod-signature"]) });
        return new Response(JSON.stringify({ answer: "It connects to  House decision.", refs: ["House decision", 3], model: "gpt-4o-mini", costUsd: 0.0007 }), { status: 200 });
      }) as unknown as typeof fetch,
    })!;
    const answer = await team.ask({ question: "Which plan  does the flat connect to?", helper: "open loops", run: "r1", test: true });
    expect(answer).toEqual({ answer: "It connects to House decision.", refs: ["House decision"], model: "gpt-4o-mini", costUsd: 0.0007 });
    expect(seen[0]!.url).toBe("https://hooks.alpha9.io/api/hooks/zenod/zcn_abc/ask");
    expect(JSON.parse(seen[0]!.body)).toEqual({ question: "Which plan does the flat connect to?", helper: "open-loops", run: "r1", test: true });
    const t = 1_700_000_000;
    expect(seen[0]!.signature).toBe(`t=${t},v1=${createHmac("sha256", signingSecret).update(`${t}.${seen[0]!.body}`).digest("hex")}`);
    // Switched off: no connection to ask.
    store.setEnabled(subscription.id, false);
    await expect(team.ask({ question: "Again?", helper: "h", run: "r2" })).rejects.toMatchObject({ code: "no_connection" });
    store.close();
  });

  it("a refusal comes back as its code, never as an answer", async () => {
    const store = new SubscriberStore(join(dir, "subscribers.sqlite"), new SqliteCredentialVault({ dataDir: dir, tenantId: "t", masterKey: "1".repeat(64) }));
    store.create({ name: "Epic Team", kind: "agent_team", url: "https://hooks.alpha9.io/api/hooks/zenod/zcn_abc", event: "voice_note.captured", via: "manual" });
    const team = teamAskFor(store, { fetch: (async () => new Response(JSON.stringify({ error: "one_per_run" }), { status: 409 })) as unknown as typeof fetch })!;
    const error = await team.ask({ question: "Which plan?", helper: "h", run: "r" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TeamAskError);
    expect(error).toMatchObject({ code: "one_per_run", status: 409 });
    store.close();
  });

  it("switches asking on once for an account connected before the release, for the helpers it already runs", () => {
    let now = new Date("2026-11-09T12:00:00Z");
    const personas = new PersonaStore(join(dir, "personas.sqlite"), () => now);
    personas.setEnabled("open-loops", true);
    personas.setEnabled("topic-gardener", false);
    expect(switchOnTeamAskForConnected(personas, null)).toEqual([]);
    const subscribers = new SubscriberStore(join(dir, "subscribers.sqlite"), new SqliteCredentialVault({ dataDir: dir, tenantId: "t", masterKey: "1".repeat(64) }), () => Date.parse("2026-11-02T21:00:00Z"));
    subscribers.create({ name: "Epic Team", kind: "agent_team", url: "https://hooks.alpha9.io/api/hooks/zenod/zcn_abc", event: "voice_note.captured", via: "oauth" });
    now = new Date("2026-11-10T10:30:00Z");
    expect(switchOnTeamAskForConnected(personas, subscribers)).toEqual(["open-loops"]);
    expect(personas.askTeam("open-loops")).toBe(true);
    expect(personas.askTeam("topic-gardener")).toBe(false);
    // His own later choice stands: switched off again, it is not switched back on at the next start.
    personas.setAskTeam("open-loops", false, false);
    expect(switchOnTeamAskForConnected(personas, subscribers)).toEqual([]);
    expect(personas.askTeam("open-loops")).toBe(false);
    personas.close();
    subscribers.close();
  });
});
