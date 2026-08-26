import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationId, type StoreResult } from "zenod";

import { captureMemoryAuthorityId } from "../src/captureMemoryAuthority.js";
import { createPhylaxUnit } from "../src/phylaxUnit.js";
import { RingCaptureTicketProducer, type CaptureTicketDelivery } from "../src/ringCaptureTicketProducer.js";
import { createRingUnit } from "../src/ringUnit.js";
import { createZenodUnit } from "../src/zenodUnit.js";

const dirs: string[] = [];
const MASTER_KEY = "44".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function stored(evidenceRef: string, page: string): StoreResult {
  return {
    evidenceRef,
    pagesTouched: [page],
    commitSha: "a".repeat(40),
    githubUrls: [],
    filing: "filed",
  };
}

describe("Ring capture context ticket", () => {
  it("migrates the reduced producer key and preserves channel/chat namespace across restart", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ring-capture-outbox-migration-"));
    dirs.push(dataDir);
    const outboxPath = join(dataDir, "outbox.sqlite");
    const legacy = new DatabaseSync(outboxPath);
    legacy.exec(`
      CREATE TABLE ring_capture_ticket_outbox (
        tenant_id TEXT NOT NULL,
        capture_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        surface TEXT NOT NULL,
        job_id TEXT NOT NULL,
        delivered_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, capture_id)
      )
    `);
    legacy.prepare(
      `INSERT INTO ring_capture_ticket_outbox
       (tenant_id, capture_id, conversation_key, surface, job_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("tenant-alpha", "42", "whatsapp:chat-a", "whatsapp", "job-wa", 1, 1);
    legacy.close();

    const delivered: string[] = [];
    const authority = captureMemoryAuthorityId({
      url: "https://memory.example/mcp",
      token: "memory-token",
    });
    const deliver = async (ticket: CaptureTicketDelivery) => {
      delivered.push([
        ticket.tenantId,
        ticket.surface,
        ticket.conversationKey,
        ticket.providerMessageId,
      ].join("|"));
      return "recorded" as const;
    };
    const first = new RingCaptureTicketProducer(outboxPath, deliver);
    first.bindMemoryJob({
      tenantId: "tenant-alpha",
      jobId: "job-wa",
      memoryAuthorityId: authority,
      captureTool: "store_memory",
    });
    first.observeJob({
      tenantId: "tenant-alpha",
      surface: "whatsapp",
      conversationKey: "whatsapp:chat-a",
      providerMessageId: "42",
      jobId: "job-wa",
    }, true);
    first.resume();
    await first.flush();
    expect(() => first.observe({
      tenantId: "tenant-alpha",
      surface: "whatsapp",
      conversationKey: "whatsapp:chat-a",
      providerMessageId: "42",
      jobId: "job-forged-replacement",
      memoryAuthorityId: authority,
      captureTool: "store_memory",
    })).toThrow("capture identity changed for an existing Ring ticket");
    first.observe({
      tenantId: "tenant-alpha",
      surface: "telegram",
      conversationKey: "telegram:chat-a",
      providerMessageId: "42",
      jobId: "job-tg",
      memoryAuthorityId: authority,
      captureTool: "store_memory",
    });
    first.observeJob({
      tenantId: "tenant-alpha",
      surface: "telegram",
      conversationKey: "telegram:chat-a",
      providerMessageId: "42",
      jobId: "job-tg",
    }, true);
    await first.flush();
    await first.close();

    expect(delivered).toEqual([
      "tenant-alpha|whatsapp|whatsapp:chat-a|42",
      "tenant-alpha|telegram|telegram:chat-a|42",
    ]);

    const restarted = new RingCaptureTicketProducer(outboxPath, deliver);
    restarted.resume();
    await restarted.flush();
    expect(delivered).toHaveLength(2);
    await restarted.close();
  });

  it("recovers the accepted-job correlation if Phylax restarted before the producer callback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ring-capture-journal-recovery-"));
    dirs.push(dataDir);
    const captureJournalPath = join(dataDir, "phylax-capture-jobs.sqlite");
    const captureJournal = new DatabaseSync(captureJournalPath);
    captureJournal.exec(`
      CREATE TABLE phylax_capture_jobs (
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        provider_message_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        job_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    captureJournal.prepare(
      `INSERT INTO phylax_capture_jobs
       (tenant_id, channel, provider_message_id, conversation_key, job_id, tool, state, created_at)
       VALUES (?, ?, ?, ?, ?, 'store_memory', 'polling', ?)`,
    ).run("tenant-alpha", "whatsapp", "wa-crash-window", "whatsapp:34611111111", "job-accepted", Date.now());
    captureJournal.close();

    const observed: CaptureTicketDelivery[] = [];
    const producer = new RingCaptureTicketProducer(
      join(dataDir, "outbox.sqlite"),
      async (ticket) => {
        observed.push(ticket);
        return "pending";
      },
    );
    try {
      producer.bindMemoryJob({
        tenantId: "tenant-alpha",
        jobId: "job-accepted",
        memoryAuthorityId: captureMemoryAuthorityId({
          url: "https://memory.example/mcp",
          token: "memory-token",
        }),
        captureTool: "store_memory",
      });
      producer.recoverFromCaptureJournal(captureJournalPath);
      await producer.flush();
      expect(observed).toEqual([]);

      const terminal = new DatabaseSync(captureJournalPath);
      terminal.prepare(
        "UPDATE phylax_capture_jobs SET state='done' WHERE tenant_id=? AND provider_message_id=?",
      ).run("tenant-alpha", "wa-crash-window");
      terminal.close();
      producer.recoverFromCaptureJournal(captureJournalPath);
      await producer.flush();
      expect(observed).toEqual([{
        tenantId: "tenant-alpha",
        surface: "whatsapp",
        conversationKey: "whatsapp:34611111111",
        providerMessageId: "wa-crash-window",
        jobId: "job-accepted",
        memoryAuthorityId: captureMemoryAuthorityId({
          url: "https://memory.example/mcp",
          token: "memory-token",
        }),
        captureTool: "store_memory",
      }]);
    } finally {
      await producer.close();
    }
  });

  it("rejects Ring-local and generic-poller jobs while accepting the exact tenant memory authority", async () => {
    const ringDir = await mkdtemp(join(tmpdir(), "ring-capture-authority-ring-"));
    const memoryDir = await mkdtemp(join(tmpdir(), "ring-capture-authority-memory-"));
    const genericDir = await mkdtemp(join(tmpdir(), "ring-capture-authority-generic-"));
    dirs.push(ringDir, memoryDir, genericDir);
    const tenantStore = () => createMemoryTenantStore([
      { token: "tenant-root", tenant: { id: "tenant-alpha", name: "Alpha" } },
    ]);
    const ring = createRingUnit({
      dataDir: ringDir,
      tenantStore: tenantStore(),
      controlPlane: { token: "ring-control" },
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    const memory = createZenodUnit({
      dataDir: memoryDir,
      tenantStore: tenantStore(),
      controlPlane: { token: "memory-control" },
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    const generic = createZenodUnit({
      dataDir: genericDir,
      tenantStore: tenantStore(),
      controlPlane: { token: "generic-control" },
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    const issue = async (
      unit: typeof ring,
      controlToken: string,
      profile: string,
    ) => {
      const response = await unit.app.request("/api/tenants/tenant-alpha/tokens", {
        method: "POST",
        headers: {
          authorization: `Bearer ${controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ profile }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { token: string }).token;
    };
    const [ringToken, memoryToken, genericToken] = await Promise.all([
      issue(ring, "ring-control", "capture-ticket"),
      issue(memory as typeof ring, "memory-control", "memory-channel"),
      issue(generic as typeof ring, "generic-control", "memory-channel"),
    ]);
    const start = async (unit: typeof ring) => {
      const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
        const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
      });
      const port = (server.address() as AddressInfo).port;
      return { server, url: `http://127.0.0.1:${port}/mcp` };
    };
    const [ringEndpoint, memoryEndpoint, genericEndpoint] = await Promise.all([
      start(ring),
      start(memory as typeof ring),
      start(generic as typeof ring),
    ]);
    const ringRuntime = ring.runtimes.forTenantStorage(
      "tenant-alpha",
      ring.storage.forTenant({ id: "tenant-alpha" }),
    );
    const memoryRuntime = memory.runtimes.forTenantStorage(
      "tenant-alpha",
      memory.storage.forTenant({ id: "tenant-alpha" }),
    );
    const genericRuntime = generic.runtimes.forTenantStorage(
      "tenant-alpha",
      generic.storage.forTenant({ id: "tenant-alpha" }),
    );
    const exactJob = memoryRuntime.taskJobStore.enqueue("store", { content: "exact authority" });
    memoryRuntime.taskJobStore.update(exactJob.id, {
      status: "done",
      result: stored("Log/2026-07-29.md#^exact", "Areas/Exact.md"),
    });
    const failedJob = memoryRuntime.taskJobStore.enqueue("store", { content: "failed authority" });
    memoryRuntime.taskJobStore.update(failedJob.id, { status: "error", error: "filing failed" });
    const genericJob = genericRuntime.taskJobStore.enqueue("store", { content: "generic poller" });
    genericRuntime.taskJobStore.update(genericJob.id, {
      status: "done",
      result: stored("Log/2026-07-29.md#^generic", "Areas/Generic.md"),
    });
    const localJob = ringRuntime.taskJobStore.enqueue("store", { content: "forged Ring-local job" });
    ringRuntime.taskJobStore.update(localJob.id, {
      status: "done",
      result: stored("Log/2026-07-29.md#^local", "Areas/Local.md"),
    });
    ringRuntime.settings.setPeers([
      {
        name: "tenant-memory",
        url: memoryEndpoint.url,
        token: memoryToken,
        tools: [
          { as: "store", mcp: "store_memory", arg: "input", description: "Store memory" },
          { as: "poll", mcp: "get_task_result", arg: "input", description: "Poll memory job" },
        ],
      },
      {
        name: "generic-poller",
        url: genericEndpoint.url,
        token: genericToken,
        tools: [
          { as: "poll", mcp: "get_task_result", arg: "input", description: "Generic poll only" },
        ],
      },
    ]);
    const client = new Client({ name: "phylax-ticket-authority-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`${ringEndpoint.url}/${ringToken}`),
    ));
    const call = (input: {
      providerMessageId: string;
      jobId: string;
      memoryAuthorityId: string;
      terminalState?: string;
      summary?: string;
      evidenceRef?: string;
    }) => client.callTool({
      name: "record_capture_ticket",
      arguments: {
        surface: "whatsapp",
        conversationKey: "whatsapp:34611111111",
        captureTool: "store_memory",
        ...input,
      },
    });
    const exactAuthorityId = captureMemoryAuthorityId({
      url: memoryEndpoint.url,
      token: memoryToken,
    });
    const genericAuthorityId = captureMemoryAuthorityId({
      url: genericEndpoint.url,
      token: genericToken,
    });
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        "record_capture_ticket",
      ]);
      expect((await call({
        providerMessageId: "local-forgery",
        jobId: localJob.id,
        memoryAuthorityId: exactAuthorityId,
      })).isError).toBe(true);
      expect((await call({
        providerMessageId: "generic-forgery",
        jobId: genericJob.id,
        memoryAuthorityId: genericAuthorityId,
      })).isError).toBe(true);
      expect((await call({
        providerMessageId: "failed-job",
        jobId: failedJob.id,
        memoryAuthorityId: exactAuthorityId,
      })).isError).toBe(true);
      expect((await call({
        providerMessageId: "caller-forgery",
        jobId: exactJob.id,
        memoryAuthorityId: exactAuthorityId,
        terminalState: "done",
        summary: "fabricated",
        evidenceRef: "Log/fake.md#^fake",
      })).isError).toBe(true);
      const accepted = await call({
        providerMessageId: "exact-job",
        jobId: exactJob.id,
        memoryAuthorityId: exactAuthorityId,
      });
      expect(accepted.structuredContent).toMatchObject({
        status: "recorded",
        evidenceRef: "Log/2026-07-29.md#^exact",
      });
      expect(await ringRuntime.state.recentCaptureTickets?.(
        conversationId("whatsapp", "whatsapp:34611111111"),
      )).toMatchObject([{
        summary: expect.stringContaining("Areas/Exact.md"),
      }]);
    } finally {
      await client.close();
      for (const endpoint of [ringEndpoint, memoryEndpoint, genericEndpoint]) {
        await new Promise<void>((resolve) => endpoint.server.close(() => resolve()));
      }
      await Promise.all([ring.close(), memory.close(), generic.close()]);
    }
  }, 15_000);

  it("wakes production Ring delivery after background terminal receipts on both provider branches", async () => {
    const phylaxDir = await mkdtemp(join(tmpdir(), "ring-capture-production-phylax-"));
    const ringDir = await mkdtemp(join(tmpdir(), "ring-capture-production-ring-"));
    const memoryDir = await mkdtemp(join(tmpdir(), "ring-capture-production-memory-"));
    dirs.push(phylaxDir, ringDir, memoryDir);
    const tenantStore = () => createMemoryTenantStore([
      { token: "tenant-root", tenant: { id: "tenant-alpha", name: "Alpha" } },
    ]);
    const ring = createRingUnit({
      dataDir: ringDir,
      tenantStore: tenantStore(),
      controlPlane: { token: "ring-control" },
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    const memory = createZenodUnit({
      dataDir: memoryDir,
      tenantStore: tenantStore(),
      controlPlane: { token: "memory-control" },
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    const issue = async (
      unit: typeof ring,
      controlToken: string,
      profile: string,
    ) => {
      const response = await unit.app.request("/api/tenants/tenant-alpha/tokens", {
        method: "POST",
        headers: {
          authorization: `Bearer ${controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ profile }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { token: string }).token;
    };
    const [ringToken, memoryToken] = await Promise.all([
      issue(ring, "ring-control", "capture-ticket"),
      issue(memory as typeof ring, "memory-control", "memory-channel"),
    ]);
    const start = async (unit: typeof ring) => {
      const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
        const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
      });
      return {
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
      };
    };
    const [ringEndpoint, memoryEndpoint] = await Promise.all([
      start(ring),
      start(memory as typeof ring),
    ]);
    const phylax = createPhylaxUnit({
      dataDir: phylaxDir,
      tenantStore: tenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        PHYLAX_RING_TICKET_URL: ringEndpoint.url,
      },
    });
    const ringRuntime = ring.runtimes.forTenantStorage(
      "tenant-alpha",
      ring.storage.forTenant({ id: "tenant-alpha" }),
    );
    const memoryRuntime = memory.runtimes.forTenantStorage(
      "tenant-alpha",
      memory.storage.forTenant({ id: "tenant-alpha" }),
    );
    ringRuntime.settings.setPeers([{
      name: "tenant-memory",
      url: memoryEndpoint.url,
      token: memoryToken,
      tools: [
        { as: "store", mcp: "store_memory", arg: "input", description: "Store memory" },
        { as: "poll", mcp: "get_task_result", arg: "input", description: "Poll memory job" },
      ],
    }]);
    const registration = phylax.phylaxTenantSettings.registerPhone(
      "tenant-alpha",
      "+34 611 111 111",
      "number-alpha",
    );
    expect(phylax.phylaxTenantSettings.verifyInbound(
      "34611111111@s.whatsapp.net",
      registration.keyword,
    )).toMatchObject({ tenantId: "tenant-alpha", verified: true });
    phylax.phylaxTenantSettings.update("tenant-alpha", {
      downstreamUrl: memoryEndpoint.url,
      downstreamToken: memoryToken,
      ringTicketUrl: ringEndpoint.url,
      ringTicketToken: ringToken,
      telegramBinding: "755555555",
    });
    // Keep the real Zenod queue authority and MCP surface, but prevent its
    // worker from consuming these controlled jobs before Phylax crosses from
    // foreground polling to the background terminal path under test.
    vi.spyOn(memoryRuntime.taskJobQueue, "enqueue").mockImplementation(
      (kind, input, idempotencyKey) =>
        memoryRuntime.taskJobStore.enqueue(kind, input, idempotencyKey),
    );
    const organOptions = (
      phylax.phylaxRuntime.organ as unknown as {
        options: {
          captureForegroundDeadlineMs?: number;
          capturePollIntervalMs?: number;
          discoverDownstream?: () => Promise<unknown>;
        };
      }
    ).options;
    organOptions.captureForegroundDeadlineMs = 5;
    organOptions.capturePollIntervalMs = 1;
    organOptions.discoverDownstream = async () => ({
      transport: "connected",
      tools: "ready",
      specs: [{
        as: "memory",
        mcp: "store_memory",
        arg: "input",
        description: "Store memory",
        inputSchema: {
          type: "object",
          required: ["content"],
          properties: { content: { type: "string", minLength: 1 } },
        },
      }],
    });
    const whatsappSend = vi.spyOn(phylax.phylaxRuntime.whatsapp, "sendText")
      .mockResolvedValue({ sentMessageId: "wa-terminal-receipt" });
    const telegramSend = vi.spyOn(phylax.phylaxRuntime.telegram, "sendText")
      .mockResolvedValue({ sentMessageId: "tg-terminal-receipt" });
    const cases = [
      {
        channel: "whatsapp" as const,
        sender: "34611111111",
        chatId: "wa-chat-alpha",
        providerMessageId: "wa-production-capture",
        evidenceRef: "Log/2026-07-29.md#^production-wa",
        page: "Areas/Production WhatsApp.md",
      },
      {
        channel: "telegram" as const,
        sender: "755555555",
        chatId: "7711",
        providerMessageId: "tg-production-capture",
        evidenceRef: "Log/2026-07-29.md#^production-tg",
        page: "Areas/Production Telegram.md",
      },
    ];
    try {
      for (const capture of cases) {
        const conversationKey = capture.channel === "telegram"
          ? `telegram:${capture.sender}`
          : `whatsapp:${capture.sender}`;
        const cid = conversationId(capture.channel, conversationKey);
        const receipt = await phylax.phylaxRuntime.organ.receive({
          channel: capture.channel,
          sender: capture.sender,
          chatId: capture.chatId,
          messageId: capture.providerMessageId,
          transcription: {
            text_transcript: `Store this through ${capture.channel}.`,
          },
        });
        const structured = receipt.downstream.structuredContent as {
          ticket_id?: unknown;
          state?: unknown;
        } | undefined;
        expect(structured?.state).toBe("accepted");
        expect(typeof structured?.ticket_id).toBe("string");
        expect(receipt.replyText).toContain("still filing");
        expect(receipt.afterReply).toBeTypeOf("function");
        expect(await ringRuntime.state.recentWindow(cid)).toEqual([]);

        const jobId = structured!.ticket_id as string;
        expect(memoryRuntime.taskJobStore.get(jobId)?.status).toBe("queued");
        memoryRuntime.taskJobStore.update(jobId, {
          status: "done",
          result: stored(capture.evidenceRef, capture.page),
        });

        // This starts the actual organ background poll. Its successful provider
        // delivery must pass through PhylaxPortedRuntime's production callback,
        // wake journal recovery, and reach Ring without restart or direct
        // producer observation/drain calls.
        receipt.afterReply?.();
        await vi.waitFor(async () => {
          expect(await ringRuntime.state.recentCaptureTickets?.(cid)).toMatchObject([{
            identity: { surface: capture.channel },
            summary: `Filed memory in ${capture.page}.`,
            evidenceRef: capture.evidenceRef,
            terminal: true,
          }]);
        }, { timeout: 5_000 });
        expect(await ringRuntime.state.recentCaptureTickets?.(cid)).toHaveLength(1);
      }

      expect(whatsappSend).toHaveBeenCalledTimes(1);
      expect(whatsappSend).toHaveBeenCalledWith(
        "34611111111",
        expect.stringContaining("Areas/Production WhatsApp.md"),
        "wa-production-capture",
      );
      expect(telegramSend).toHaveBeenCalledTimes(1);
      expect(telegramSend).toHaveBeenCalledWith(
        "7711",
        expect.stringContaining("Areas/Production Telegram.md"),
      );
      expect(JSON.stringify(whatsappSend.mock.calls)).not.toContain("Log/2026-07-29.md#^production-wa");
      expect(JSON.stringify(telegramSend.mock.calls)).not.toContain("Log/2026-07-29.md#^production-tg");
      expect(phylax.phylaxTenantSettings.downstreamCredentials("tenant-alpha")).toEqual({
        url: memoryEndpoint.url,
        token: memoryToken,
      });
      expect(phylax.phylaxTenantSettings.ringTicketCredentials("tenant-alpha")).toEqual({
        url: ringEndpoint.url,
        token: ringToken,
      });

      const journal = new DatabaseSync(
        join(phylaxDir, "phylax-capture-jobs.sqlite"),
        { readOnly: true },
      );
      const providerReceipts = journal.prepare(
        `SELECT channel, provider_receipt_message_id
         FROM phylax_capture_receipts
         ORDER BY channel`,
      ).all();
      journal.close();
      expect(providerReceipts).toEqual([
        { channel: "telegram", provider_receipt_message_id: "tg-terminal-receipt" },
        { channel: "whatsapp", provider_receipt_message_id: "wa-terminal-receipt" },
      ]);

      await phylax.phylaxRuntime.organ.resumePendingCaptures();
      expect(whatsappSend).toHaveBeenCalledTimes(1);
      expect(telegramSend).toHaveBeenCalledTimes(1);
    } finally {
      await phylax.close();
      await new Promise<void>((resolve) => ringEndpoint.server.close(() => resolve()));
      await new Promise<void>((resolve) => memoryEndpoint.server.close(() => resolve()));
      await Promise.all([ring.close(), memory.close()]);
    }
  }, 15_000);
});
