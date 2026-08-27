import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "zenod";

import { Settings } from "../src/settings.js";
import {
  PhylaxChannelsOrgan,
  type PhylaxDownstreamCall,
} from "../src/phylaxChannels.js";
import { defaultPhylaxTurnBindings } from "../src/phylaxTenantSettings.js";

interface EvidencePointer {
  file: string;
  test: string;
}

interface BaselineContract {
  contractVersion: number;
  sourceBaseline: string;
  deployedBaseline: { source: string; ociIndex: string; status: string };
  architectureInvariants: Record<string, string>;
  fixtures: Array<{
    id: string;
    kind: string;
    input: { messageId: string; text?: string };
    expected: Record<string, unknown>;
    automatedEvidence: EvidencePointer;
  }>;
  scenarios: Array<{
    id: string;
    automatedStatus: "proved" | "failed" | "unproved";
    productionStatus: string;
    evidence: EvidencePointer;
  }>;
  knownUnprovedProductionClaims: string[];
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const contractPath = join(
  repositoryRoot,
  "docs/evidence/zpf-1-baseline-contract-2026-08-27/contract.json",
);
const tempDirs: string[] = [];

async function loadContract(): Promise<BaselineContract> {
  return JSON.parse(await readFile(contractPath, "utf8")) as BaselineContract;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ZPF-1 frozen Zenod/Phylax baseline", () => {
  it("keeps every required journey and continuity invariant linked to executable evidence", async () => {
    const contract = await loadContract();
    const requiredFixtureIds = ["intake_text", "intake_url", "intake_image", "intake_voice"];
    const requiredScenarioIds = [
      "voice_overlap_three",
      "exact_redelivery_dedupe",
      "voice_lte_two_hours",
      "voice_gt_two_hours_archive_only",
      "drive_aware_terminal_receipt",
      "restart_capture_recovery",
      "cap_pause_capture_first",
      "one_terminal_response",
      "direct_mcp_bearer_continuity",
      "oauth_client_token_continuity",
      "tenant_google_continuity",
      "whatsapp_session_continuity",
      "telegram_binding_continuity",
      "tenant_binding_continuity",
      "independent_volume_identity",
    ];

    expect(contract.contractVersion).toBe(1);
    expect(contract.sourceBaseline).toMatch(/^[a-f0-9]{40}$/);
    expect(contract.deployedBaseline.source).toMatch(/^[a-f0-9]{40}$/);
    expect(contract.deployedBaseline.ociIndex).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(contract.fixtures.map((fixture) => fixture.id).sort()).toEqual([...requiredFixtureIds].sort());
    expect(contract.scenarios.map((scenario) => scenario.id).sort()).toEqual([...requiredScenarioIds].sort());
    expect(Object.keys(contract.architectureInvariants).sort()).toEqual([
      "architectureAuthority",
      "browserBoundary",
      "captureRule",
      "identityContinuity",
      "runtimeBoundary",
      "serviceOwnership",
      "voiceRule",
    ]);

    const evidence = [
      ...contract.fixtures.map((fixture) => fixture.automatedEvidence),
      ...contract.scenarios.map((scenario) => scenario.evidence),
    ];
    for (const pointer of evidence) {
      const source = await readFile(join(repositoryRoot, pointer.file), "utf8");
      expect(source, pointer.file).toContain(`it(\"${pointer.test}\"`);
    }

    expect(contract.scenarios.every((scenario) => scenario.automatedStatus === "proved")).toBe(true);
    expect(contract.knownUnprovedProductionClaims.length).toBeGreaterThan(0);
    expect(contract.scenarios.some((scenario) => scenario.productionStatus === "unproved")).toBe(true);
  });

  it("runs the frozen text and URL fixtures through the current direct Zenod seam", async () => {
    const contract = await loadContract();
    const fixtures = contract.fixtures.filter((fixture) => fixture.kind === "text" || fixture.kind === "url");
    const dataDir = await mkdtemp(join(tmpdir(), "zpf1-direct-seam-"));
    tempDirs.push(dataDir);
    const calls: PhylaxDownstreamCall[] = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir,
      routes: {
        resolve: () => ({
          tenantId: "alpha",
          downstreamUrl: "https://zenod.test/mcp/alpha",
          downstreamToken: "fixture-memory-token",
          turnBindings: defaultPhylaxTurnBindings(),
        }),
      },
      discoverDownstream: async () => ({
        transport: "connected",
        tools: "ready",
        specs: [{
          as: "chat",
          mcp: "chat_with_zenod",
          description: "Direct Zenod fixture",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["message", "surface", "conversationKey"],
            properties: {
              message: { type: "string" },
              surface: { const: "whatsapp" },
              conversationKey: { type: "string" },
              idempotencyKey: { type: "string" },
            },
          },
        }],
      }),
      capturePollIntervalMs: 1,
      sleep: async () => undefined,
      async callDownstream(call) {
        calls.push(call);
        if (call.tool === "chat_with_zenod") {
          const idempotencyKey = String(call.arguments.idempotencyKey);
          return {
            content: [{ type: "text", text: "queued" }],
            structuredContent: {
              ticket_id: `job:${idempotencyKey}`,
              state: "accepted",
            },
          };
        }
        const ticketId = String(call.arguments.ticket_id);
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: ticketId,
            state: "done",
            result: { text: `Saved ${ticketId.slice("job:".length)}`, sources: [] },
          },
        };
      },
    });

    try {
      for (const fixture of fixtures) {
        const receipt = await organ.receive({
          channel: "whatsapp",
          sender: "34611111111",
          chatId: "34611111111@s.whatsapp.net",
          messageId: fixture.input.messageId,
          text: fixture.input.text,
        });
        expect(receipt.replyText).toContain(String(fixture.expected.idempotencyKey));
      }
      const chatCalls = calls.filter((call) => call.tool === "chat_with_zenod");
      expect(chatCalls).toHaveLength(2);
      expect(chatCalls.map((call) => ({
        tool: call.tool,
        idempotencyKey: call.arguments.idempotencyKey,
        message: call.arguments.message,
      }))).toEqual(fixtures.map((fixture) => ({
        tool: fixture.expected.tool,
        idempotencyKey: fixture.expected.idempotencyKey,
        message: fixture.input.text,
      })));
    } finally {
      await organ.close();
    }
  });

  it("keeps the direct MCP bearer byte-identical across ordinary restart and changed seed input", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "zpf1-mcp-bearer-"));
    tempDirs.push(dataDir);
    const statePath = join(dataDir, "settings.sqlite");

    const firstStore = new SqliteStateStore(statePath);
    const first = new Settings(firstStore);
    first.seedFromEnv({ ZENOD_API_TOKEN: "existing-tenant-bearer" } as NodeJS.ProcessEnv);
    expect(first.apiToken()).toBe("existing-tenant-bearer");
    firstStore.close();

    const restartedStore = new SqliteStateStore(statePath);
    const restarted = new Settings(restartedStore);
    restarted.seedFromEnv({ ZENOD_API_TOKEN: "replacement-seed-must-not-apply" } as NodeJS.ProcessEnv);
    expect(restarted.apiToken()).toBe("existing-tenant-bearer");
    restartedStore.close();
  });

  it("pins the independent Zenod and Phylax production volume identities without reading secrets", async () => {
    const contract = await loadContract();
    const rollout = await readFile(
      join(repositoryRoot, "docs/evidence/zenod-zal22-production-rollout-2026-08-27/README.md"),
      "utf8",
    );
    expect(rollout).toContain("`zenod-mt-data:/data` RW");
    expect(rollout).toContain("`phylax-data:/data` RW");
    expect(rollout).toContain(contract.deployedBaseline.source);
    expect(rollout).toContain(contract.deployedBaseline.ociIndex);
    expect(rollout).toContain("No environment, mount, replica, credential, token, session, route, or data value was changed");
  });
});
