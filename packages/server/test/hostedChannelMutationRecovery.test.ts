import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeHostedChannelMutation,
  HostedChannelMutationAuditStore,
  type HostedChannelMutationName,
} from "../src/hostedChannels.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dataDir() {
  const dir = await mkdtemp(join(tmpdir(), "hosted-mutation-recovery-"));
  dirs.push(dir);
  return dir;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function claimInput(input: {
  operationId: string;
  tenantId: string;
  authorityScope?: string;
  operation?: HostedChannelMutationName;
  body?: Record<string, unknown>;
  target?: string;
  revision?: string;
}) {
  const operation = input.operation ?? "management.ensure_binding";
  const body = input.body ?? { value: "exact" };
  return {
    operationId: input.operationId,
    tenantId: input.tenantId,
    authorityScope: input.authorityScope ?? "management:zenod",
    operation,
    requestHash: digest(JSON.stringify({ operation, body })),
    targetHash: digest(input.target ?? "target"),
    bindingRevision: input.revision ?? "0",
    at: Date.now(),
  };
}

function mutationBody(operationId: string, operation: HostedChannelMutationName) {
  return {
    mutation: { operationId, operation, outcome: "succeeded" as const, at: 1 },
  };
}

describe("durable hosted-channel mutation recovery", () => {
  it("namespaces the same operation id by tenant and authority", async () => {
    const dir = await dataDir();
    const store = new HostedChannelMutationAuditStore(dir);
    let effects = 0;
    const run = (tenantId: string, authorityScope: string) =>
      executeHostedChannelMutation(
        store,
        {
          operationId: "shared-operation-01",
          tenantId,
          authorityScope,
          operation: "management.ensure_binding",
          requestBody: { value: "exact" },
          target: "target",
          bindingRevision: () => "0",
        },
        () => {
          effects += 1;
          return {
            status: 200,
            body: mutationBody("shared-operation-01", "management.ensure_binding"),
          };
        },
      );

    expect((await run("alpha", "management:zenod")).status).toBe(200);
    expect((await run("beta", "management:zenod")).status).toBe(200);
    expect((await run("alpha", "management:pm")).status).toBe(200);
    expect((await run("alpha", "management:zenod")).status).toBe(200);
    expect(effects).toBe(3);
    store.close();
  });

  it("reconciles an observable effect after restart without repeating it", async () => {
    const dir = await dataDir();
    const operationId = "recover-observable-01";
    const operation = "management.ensure_binding" as const;
    let applied = false;
    let effects = 0;
    const first = new HostedChannelMutationAuditStore(dir, {
      executorId: "before-crash",
      claimLeaseMs: 0,
    });
    expect(first.claim(claimInput({ operationId, tenantId: "alpha", operation }))).toEqual({
      kind: "claimed",
    });
    effects += 1;
    applied = true;
    first.close();

    const restarted = new HostedChannelMutationAuditStore(dir, {
      executorId: "after-restart",
      claimLeaseMs: 0,
    });
    const recovered = await executeHostedChannelMutation(
      restarted,
      {
        operationId,
        tenantId: "alpha",
        authorityScope: "management:zenod",
        operation,
        requestBody: { value: "exact" },
        target: "target",
        bindingRevision: () => (applied ? "1" : "0"),
        recoverOrphaned: () =>
          applied
            ? {
                state: "applied",
                result: { status: 200, body: mutationBody(operationId, operation) },
              }
            : { state: "not_applied" },
      },
      () => {
        effects += 1;
        applied = true;
        return { status: 200, body: mutationBody(operationId, operation) };
      },
    );
    expect(recovered).toMatchObject({ status: 200, body: { mutation: { outcome: "succeeded" } } });
    expect(effects).toBe(1);
    expect((await executeHostedChannelMutation(
      restarted,
      {
        operationId,
        tenantId: "alpha",
        authorityScope: "management:zenod",
        operation,
        requestBody: { value: "exact" },
        target: "target",
        bindingRevision: () => "1",
      },
      () => {
        effects += 1;
        return { status: 500, body: {} };
      },
    )).status).toBe(200);
    expect(effects).toBe(1);
    restarted.close();
  });

  it("terminalizes an orphaned non-observable send as outcome unknown and never retries", async () => {
    const dir = await dataDir();
    const operationId = "send-outcome-unknown-01";
    const operation = "whatsapp.test" as const;
    let sends = 0;
    const first = new HostedChannelMutationAuditStore(dir, {
      executorId: "send-before-crash",
      claimLeaseMs: 0,
    });
    expect(first.claim(claimInput({
      operationId,
      tenantId: "alpha",
      authorityScope: "management:zenod",
      operation,
      body: { channel: "whatsapp" },
      target: "+34611111111",
      revision: "7",
    }))).toEqual({ kind: "claimed" });
    sends += 1;
    first.close();

    const restarted = new HostedChannelMutationAuditStore(dir, {
      executorId: "send-after-restart",
      claimLeaseMs: 0,
    });
    const run = () => executeHostedChannelMutation(
      restarted,
      {
        operationId,
        tenantId: "alpha",
        authorityScope: "management:zenod",
        operation,
        requestBody: { channel: "whatsapp" },
        target: "+34611111111",
        bindingRevision: () => "7",
      },
      () => {
        sends += 1;
        return { status: 200, body: mutationBody(operationId, operation) };
      },
    );
    const unknown = await run();
    expect(unknown).toMatchObject({
      status: 409,
      body: {
        error: {
          code: "operation_outcome_unknown",
          retryDisposition: "do_not_retry",
        },
      },
    });
    expect((await run()).body).toEqual(unknown.body);
    expect(sends).toBe(1);
    restarted.close();
  });

  it("renews and fences a slow live effect so another executor cannot seize it", async () => {
    const dir = await dataDir();
    const first = new HostedChannelMutationAuditStore(dir, {
      executorId: "slow-live-a",
      claimLeaseMs: 45,
    });
    const second = new HostedChannelMutationAuditStore(dir, {
      executorId: "slow-live-b",
      claimLeaseMs: 45,
    });
    let effects = 0;
    const input = {
      operationId: "slow-live-effect-01",
      tenantId: "alpha",
      authorityScope: "management:zenod",
      operation: "management.ensure_binding" as const,
      requestBody: { value: "exact" },
      target: "target",
      bindingRevision: () => "0",
      recoverOrphaned: () => ({ state: "unknown" as const }),
    };
    const live = executeHostedChannelMutation(first, input, async () => {
      effects += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        status: 200,
        body: mutationBody(input.operationId, input.operation),
      };
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const overlap = executeHostedChannelMutation(second, input, () => {
      effects += 1;
      return { status: 200, body: mutationBody(input.operationId, input.operation) };
    });
    expect((await live).status).toBe(200);
    expect((await overlap).status).toBe(200);
    expect(effects).toBe(1);
    first.close();
    second.close();
  });

  it("replays a legacy public-route terminal row after the scoped-key migration", async () => {
    const dir = await dataDir();
    const operationId = "legacy-public-operation-01";
    const operation = "whatsapp.disconnect" as const;
    const body = mutationBody(operationId, operation);
    const db = new DatabaseSync(join(dir, "hosted-channel-mutations.sqlite"));
    db.exec(`
      CREATE TABLE hosted_channel_mutations (
        operation_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT,
        target_hash TEXT,
        claim_binding_revision TEXT,
        terminal_binding_revision TEXT,
        state TEXT,
        outcome TEXT NOT NULL,
        error_code TEXT,
        http_status INTEGER,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);
    db.prepare(
      `INSERT INTO hosted_channel_mutations VALUES
       (?, ?, ?, ?, ?, ?, ?, 'terminal', 'succeeded', NULL, 200, ?, 1, 1)`,
    ).run(
      operationId,
      "alpha",
      operation,
      digest(JSON.stringify({ operation, body: {} })),
      digest("target"),
      "0",
      "0",
      JSON.stringify(body),
    );
    db.close();

    const store = new HostedChannelMutationAuditStore(dir);
    let effects = 0;
    const replay = await executeHostedChannelMutation(
      store,
      {
        operationId,
        tenantId: "alpha",
        operation,
        requestBody: {},
        target: "target",
        bindingRevision: () => "0",
      },
      () => {
        effects += 1;
        return { status: 500, body: {} };
      },
    );
    expect(replay).toEqual({ status: 200, body });
    expect(effects).toBe(0);
    store.close();
  });
});
