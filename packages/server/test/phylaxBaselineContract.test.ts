import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";

import { PhylaxChannelsOrgan } from "../src/phylaxChannels.js";
import { defaultPhylaxTurnBindings } from "../src/phylaxTenantSettings.js";
import { callPeerTool, type PeerToolResult } from "../src/peerClient.js";
import { createZenodUnit } from "../src/zenodUnit.js";

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
    automatedStatus: "proved" | "failed" | "unproved";
    productionStatus: string;
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
  knownSourceBaselineFailures: Array<{
    id: string;
    code: string;
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
      ...contract.knownSourceBaselineFailures.map((failure) => failure.evidence),
    ];
    for (const pointer of evidence) {
      const source = await readFile(join(repositoryRoot, pointer.file), "utf8");
      expect(source, pointer.file).toContain(`it(\"${pointer.test}\"`);
    }

    expect(contract.fixtures.filter((fixture) => fixture.automatedStatus === "failed").map((fixture) => fixture.id))
      .toEqual(["intake_text", "intake_url"]);
    expect(contract.fixtures.some((fixture) => fixture.automatedStatus === "unproved")).toBe(false);
    expect(contract.scenarios.every((scenario) => scenario.automatedStatus === "proved")).toBe(true);
    expect(contract.knownSourceBaselineFailures).toMatchObject([{
      id: "real_composed_text_url_boundary",
      code: "undeclared_long_tool",
    }]);
    expect(contract.knownUnprovedProductionClaims.length).toBeGreaterThan(0);
    expect(contract.scenarios.some((scenario) => scenario.productionStatus === "unproved")).toBe(true);
  });

  it("records the current text and URL failure across the real authenticated Zenod MCP ticket boundary", async () => {
    const contract = await loadContract();
    const fixtures = contract.fixtures.filter((fixture) => fixture.kind === "text" || fixture.kind === "url");
    const rootDir = await mkdtemp(join(tmpdir(), "zpf1-real-seam-"));
    tempDirs.push(rootDir);
    const alphaToken = "zpf1-alpha-memory-token";
    const betaToken = "zpf1-beta-memory-token";
    const unit = createZenodUnit({
      dataDir: join(rootDir, "zenod"),
      tenantStore: createMemoryTenantStore([
        { token: alphaToken, tenant: { id: "alpha" } },
        { token: betaToken, tenant: { id: "beta" } },
      ]),
      env: {
        NODE_ENV: "test",
        CHASSIS_VAULT_MASTER_KEY: "11".repeat(32),
      },
      appOptionsForTenant(_tenantId, runtime) {
        runtime.getEngine = async () => ({
          async chat(message: string) {
            return { text: `Real Zenod reply: ${message}`, sources: [] };
          },
        }) as Awaited<ReturnType<typeof runtime.getEngine>>;
        return {};
      },
    });

    const server = await new Promise<ReturnType<typeof serve>>((resolveServer) => {
      const started = serve(
        { fetch: unit.app.fetch, hostname: "127.0.0.1", port: 0 },
        () => resolveServer(started),
      );
    });
    const address = server.address() as AddressInfo;
    const zenodOrigin = `http://127.0.0.1:${address.port}`;
    const alphaRoute = {
      tenantId: "alpha",
      downstreamUrl: `${zenodOrigin}/mcp/${alphaToken}`,
      downstreamToken: alphaToken,
      turnBindings: defaultPhylaxTurnBindings(),
    };
    const authMismatch = await fetch(alphaRoute.downstreamUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${betaToken}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(authMismatch.status).toBe(401);

    const downstreamCalls: Array<{ tool: string; result: PeerToolResult }> = [];
    const organ = new PhylaxChannelsOrgan({
      dataDir: join(rootDir, "phylax"),
      routes: {
        resolve: () => alphaRoute,
      },
      capturePollIntervalMs: 1,
      sleep: async () => undefined,
      async callDownstream(call) {
        const result = await callPeerTool({
          name: `zpf1-${call.route.tenantId}`,
          url: call.route.downstreamUrl,
          token: call.route.downstreamToken,
        }, call.tool, call.arguments);
        downstreamCalls.push({ tool: call.tool, result });
        return result;
      },
    });

    try {
      for (const fixture of fixtures) {
        const received = organ.receive({
          channel: "whatsapp",
          sender: "34611111111",
          chatId: "34611111111@s.whatsapp.net",
          messageId: fixture.input.messageId,
          text: fixture.input.text,
        });
        await expect(received).rejects.toMatchObject({
          name: "PhylaxChannelError",
          code: "downstream_error",
          audit: { failureCode: "downstream_rejected" },
          retryDisposition: "idempotent_capture",
        });
      }
      const chatResults = downstreamCalls
        .filter((call) => call.tool === "chat_with_zenod")
        .map((call) => call.result);
      expect(chatResults).toHaveLength(2);
      for (const result of chatResults) {
        expect(result).toMatchObject({
          isError: true,
          structuredContent: {
            error: {
              code: "undeclared_long_tool",
              message: expect.stringContaining(
                'Tool "chat_with_zenod" returned an accepted ticket but is not declared in conduct.longTools.',
              ),
            },
          },
        });
      }
      const jobs = unit.runtimes.get("alpha")?.taskJobStore.recent(10) ?? [];
      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => ({
        kind: job.kind,
        idempotencyKey: job.idempotencyKey,
        message: job.input.text,
        status: job.status,
      })).sort((left, right) => String(left.idempotencyKey).localeCompare(String(right.idempotencyKey))))
        .toEqual(fixtures.map((fixture) => ({
          kind: "chat",
          idempotencyKey: fixture.expected.idempotencyKey,
          message: fixture.input.text,
          status: "done",
        })).sort((left, right) => String(left.idempotencyKey).localeCompare(String(right.idempotencyKey))));
    } finally {
      await organ.close();
      await new Promise<void>((resolveServer, reject) => {
        server.close((error) => error ? reject(error) : resolveServer());
      });
      unit.close();
    }
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
