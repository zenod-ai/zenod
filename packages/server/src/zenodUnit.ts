import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChassisStorage,
  createUnit,
  type ControlPlaneOptions,
  type TenantProvisioningStore,
  type UnitContext,
} from "@zenod/mcp-chassis";
import {
  VERSION,
  createGithubIssue,
  editGithubIssue,
} from "zenod";
import { ZENOD_AGENT } from "./agent.js";
import { ChassisCredentialVault } from "./credentialVault.js";
import { buildDriveTools } from "./driveTools.js";
import { driveClientFromSettings } from "./drive.js";
import { buildMcpServer } from "./mcp.js";
import { Runtime } from "./runtime.js";
import type { ChatTestAuditStore } from "./testHarness.js";

export class ZenodRuntimePool {
  private readonly runtimes = new Map<string, Runtime>();

  forContext(context: UnitContext): Runtime {
    if (!context.tenant || !context.storage) {
      throw new Error("Zenod requires an authenticated chassis tenant context");
    }
    const tenantId = context.tenant.id;
    const existing = this.runtimes.get(tenantId);
    if (existing) {
      if (existing.dataDir !== context.storage.rootDir) {
        throw new Error("chassis tenant storage root changed during process lifetime");
      }
      return existing;
    }
    const runtime = new Runtime(context.storage.rootDir, ZENOD_AGENT, {
      seedFromEnv: false,
      tenantId,
      credentialVault: new ChassisCredentialVault(context.storage),
    });
    this.runtimes.set(tenantId, runtime);
    return runtime;
  }

  get(tenantId: string): Runtime | null {
    return this.runtimes.get(tenantId) ?? null;
  }

  close(): void {
    for (const runtime of this.runtimes.values()) runtime.close();
    this.runtimes.clear();
  }
}

function registerZenodTools(
  server: McpServer,
  runtime: Runtime,
): void {
  const { settings } = runtime;
  const chatTestAudit = runtime.state as unknown as ChatTestAuditStore;
  buildMcpServer(
    () => runtime.getEngine(),
    () => buildDriveTools(settings, runtime.ingestQueue),
    () => runtime.cleanSlate(),
    (input) => chatTestAudit.recordChatTestRun(input),
    {
      enqueue: (kind, input) => runtime.taskJobQueue.enqueue(kind, input),
      get: (id) => runtime.taskJobQueue.get(id),
    },
    (input) => editGithubIssue(settings, input),
    (input) => createGithubIssue(settings, input),
    ZENOD_AGENT.name,
    undefined,
    undefined,
    undefined,
    (input) => runtime.whatsappStore.recentTranscript(input),
    undefined,
    undefined,
    (query) => runtime.usageStore.timeline(query),
    settings.get("instance_name") ?? "",
    {
      async enqueueAudio({ bytesRef, filename, hints, contentHint, sourceHint }) {
        const client = driveClientFromSettings(settings);
        if (!client) {
          throw new Error("Google Drive evidence archive is not connected");
        }
        const file = await client.getFile(bytesRef);
        const filingHints = [
          ...(hints ?? []),
          ...(contentHint ? [`content hint: ${contentHint}`] : []),
          ...(sourceHint ? [`source: ${sourceHint}`] : []),
        ];
        return runtime.ingestQueue.enqueue(
          bytesRef,
          filename ?? file.name,
          filingHints,
        );
      },
      get: (id) => runtime.ingestStore.get(id),
    },
    server,
  );
}

export interface CreateZenodUnitOptions {
  dataDir?: string;
  webDist?: string;
  tenantStore: TenantProvisioningStore;
  controlPlane?: Omit<ControlPlaneOptions, "store">;
}

export function createZenodUnit(options: CreateZenodUnitOptions) {
  const storage = new ChassisStorage({ dataDir: options.dataDir });
  const runtimes = new ZenodRuntimePool();
  const unit = createUnit({
    name: "zenod",
    version: VERSION,
    tenantAuth: { store: options.tenantStore },
    ...(options.controlPlane
      ? {
          controlPlane: {
            ...options.controlPlane,
            store: options.tenantStore,
          },
        }
      : {}),
    storage,
    metering: { dataDir: storage.dataDir },
    ui: {
      ...(options.webDist ? { webDist: options.webDist } : {}),
      displayName: ZENOD_AGENT.displayName,
      tagline: ZENOD_AGENT.tagline,
      panels: [
        "chat",
        "vault",
        "keys",
        "transcription",
        "connections",
        "costs",
        "test",
      ],
    },
    tools(server, context) {
      registerZenodTools(server, runtimes.forContext(context));
    },
  });
  return { ...unit, runtimes, storage };
}
