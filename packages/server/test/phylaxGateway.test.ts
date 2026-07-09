import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  PhylaxGatewaySeam,
  PhylaxSeamError,
  type PhylaxDeliveryAdapter,
  type PhylaxRingClient,
} from "../src/phylaxGateway.js";
import { Runtime } from "../src/runtime.js";

function seam(options: {
  ring?: PhylaxRingClient;
  delivery?: PhylaxDeliveryAdapter;
  acceptAll?: boolean;
  allowedSenders?: string[];
  groupsEnabled?: boolean;
} = {}) {
  return new PhylaxGatewaySeam({
    settings: {
      providerMode: "cloud",
      testRecipient: "34611111111@s.whatsapp.net",
      acceptAll: options.acceptAll ?? false,
      allowedSenders: options.allowedSenders ?? ["34611111111"],
      groupsEnabled: options.groupsEnabled ?? false,
    },
    ring:
      options.ring ??
      ({
        async messageReceived() {
          return { evidence: [{ kind: "mailbox_entry_created", mailbox_id: "mbx_1" }] };
        },
      } satisfies PhylaxRingClient),
    delivery:
      options.delivery ??
      ({
        async send() {
          return { sentMessageId: "sent_1" };
        },
      } satisfies PhylaxDeliveryAdapter),
  });
}

describe("PhylaxGatewaySeam", () => {
  it("accepts inbound channel events into Ring and returns only the Ring-facing receipt", async () => {
    const calls: unknown[] = [];
    const gateway = seam({
      ring: {
        async messageReceived(input) {
          calls.push(input);
          return { evidence: [{ kind: "mailbox_entry_created", mailbox_id: "mailbox_123" }] };
        },
      },
    });

    const result = await gateway.receiveInbound({
      channel: "whatsapp",
      chatId: "34611111111@s.whatsapp.net",
      contactId: "34611111111@s.whatsapp.net",
      senderName: "Tester",
      text: "remember this later",
      providerMessageId: "wamid.1",
      media: {
        mimeType: "image/png",
        fileName: "shot.png",
        bytes: Buffer.from("fake-image"),
      },
    });

    expect(calls).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        chat_id: "34611111111@s.whatsapp.net",
        contact_id: "34611111111@s.whatsapp.net",
        text: "remember this later",
        media_id: expect.stringMatching(/^phylax_media_/),
        media_meta: expect.objectContaining({
          mime_type: "image/png",
          file_name: "shot.png",
          provider_message_id: "wamid.1",
          source: "phylax",
        }),
      }),
    ]);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: "ring_message_accepted",
        channel: "whatsapp",
        chat_id: "34611111111@s.whatsapp.net",
        mailbox_id: "mailbox_123",
        media_id: expect.stringMatching(/^phylax_media_/),
      }),
    ]);

    const mediaId = result.evidence[0]!.media_id!;
    expect(gateway.getMedia(mediaId)).toEqual(
      expect.objectContaining({
        media_id: mediaId,
        mime_type: "image/png",
        file_name: "shot.png",
        bytes_b64: Buffer.from("fake-image").toString("base64"),
      }),
    );
  });

  it("delivers outbound text exactly as Ring supplied it and requires a delivery receipt", async () => {
    const sent: unknown[] = [];
    const gateway = seam({
      delivery: {
        async send(input) {
          sent.push(input);
          return { sentMessageId: "provider_msg_1" };
        },
      },
    });

    const result = await gateway.sendToUser({
      channel: "whatsapp",
      chatId: "34611111111@s.whatsapp.net",
      text: "Mentor: exact reply\nwith punctuation.",
      replyToMailboxId: "mailbox_123",
    });

    expect(sent).toEqual([
      {
        channel: "whatsapp",
        chatId: "34611111111@s.whatsapp.net",
        text: "Mentor: exact reply\nwith punctuation.",
        replyToMailboxId: "mailbox_123",
      },
    ]);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: "message_sent",
        channel: "whatsapp",
        chat_id: "34611111111@s.whatsapp.net",
        sent_message_id: "provider_msg_1",
      }),
    ]);
  });

  it("errors loudly instead of returning silent acks", async () => {
    const gateway = seam({
      delivery: {
        async send() {
          return {};
        },
      },
    });

    await expect(
      gateway.sendToUser({
        channel: "whatsapp",
        chatId: "34611111111@s.whatsapp.net",
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "invalid_receipt" });
  });

  it("sends configured test messages through the same outbound receipt path", async () => {
    const sent: unknown[] = [];
    const gateway = seam({
      delivery: {
        async send(input) {
          sent.push(input);
          return { sentMessageId: "test_msg_1" };
        },
      },
    });

    const result = await gateway.sendTestMessage("whatsapp", "cloud provider smoke test");

    expect(sent).toEqual([
      {
        channel: "whatsapp",
        chatId: "34611111111@s.whatsapp.net",
        text: "cloud provider smoke test",
        replyToMailboxId: null,
      },
    ]);
    expect(result.evidence[0]).toEqual(expect.objectContaining({ kind: "message_sent", sent_message_id: "test_msg_1" }));
  });

  it("enforces channel allowlists before handing inbound events to Ring", async () => {
    const calls: unknown[] = [];
    const gateway = seam({
      ring: {
        async messageReceived(input) {
          calls.push(input);
          return { mailbox_id: "mbx" };
        },
      },
    });

    await expect(
      gateway.receiveInbound({
        channel: "whatsapp",
        chatId: "34622222222@s.whatsapp.net",
        contactId: "34622222222@s.whatsapp.net",
        text: "hello",
      }),
    ).rejects.toBeInstanceOf(PhylaxSeamError);
    expect(calls).toEqual([]);
  });

  it("keeps cloud mode distinct from self-host QR mode", () => {
    const cloud = seam();
    expect(cloud.pairingStatus()).toEqual(
      expect.objectContaining({
        mode: "cloud",
        state: "cloud",
        qr_available: false,
      }),
    );

    const selfHost = new PhylaxGatewaySeam({
      settings: {
        providerMode: "self_host_dev",
        testRecipient: null,
        acceptAll: true,
        allowedSenders: [],
        groupsEnabled: true,
      },
      ring: {
        async messageReceived() {
          return { mailbox_id: "mbx" };
        },
      },
      delivery: {
        async send() {
          return { sentMessageId: "sent" };
        },
      },
      connectionState: "pairing",
      linkedNumber: "34611111111@s.whatsapp.net",
    });

    expect(selfHost.pairingStatus()).toEqual(
      expect.objectContaining({
        mode: "self_host_dev",
        state: "pairing",
        linked_number: "34611111111",
        qr_available: true,
      }),
    );
  });
});

describe("Phylax tenant API", () => {
  it("requires bearer auth for hosted channel status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-phylax-api-auth-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    try {
      expect((await app.request("/api/phylax/status")).status).toBe(401);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads and writes Phylax channel config with media ownership assigned to Zenod", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-phylax-api-config-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" };
    try {
      const saved = await app.request("/api/phylax/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          whatsapp: {
            enabled: true,
            providerMode: "cloud",
            cloudProvider: "managed-whatsapp",
            cloudWebhookUrl: "https://ring.example.test/webhooks/phylax",
            cloudPhoneNumberId: "pn_123",
            cloudStatus: "configured",
            testRecipient: "+34 611 111 111",
            allowedSenders: ["+34 611 111 111"],
            groupsEnabled: true,
            acceptAll: false,
          },
          telegram: {
            enabled: false,
            allowedUsers: ["123"],
            acceptAll: false,
            rich: true,
          },
        }),
      });

      expect(saved.status).toBe(200);
      const body = await saved.json();
      expect(body.unit).toMatchObject({ id: "phylax", parent: "ring", role: "channel_gateway" });
      expect(body.channels.whatsapp).toMatchObject({
        enabled: true,
        providerMode: "cloud",
        cloud: expect.objectContaining({ provider: "managed-whatsapp", status: "configured" }),
        allowlist: { acceptAll: false, allowedSenders: ["34611111111"], groupsEnabled: true },
      });
      expect(body.mediaHandoff.owner).toBe("zenod");
      expect(body.mediaHandoff.zenodOwns).toEqual(expect.arrayContaining(["drive_archive", "transcription", "ocr", "digest"]));
      expect(body.mediaHandoff.ringOwns).not.toEqual(expect.arrayContaining(["drive_archive", "transcription", "ocr", "digest"]));

      const status = await (await app.request("/api/phylax/status", { headers })).json();
      expect(status.channels.whatsapp.health.status).toBe("unavailable");
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test-send returns an explicit error when no live provider sender is connected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-phylax-api-test-send-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" };
    try {
      await app.request("/api/phylax/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({ whatsapp: { enabled: true, providerMode: "cloud", cloudStatus: "configured" } }),
      });

      const sent = await app.request("/api/phylax/test-send", {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: "whatsapp", text: "hosted cloud smoke" }),
      });
      expect(sent.status).toBe(409);
      const body = await sent.json();
      expect(body).toMatchObject({
        ok: false,
        code: "unavailable",
        error: expect.stringContaining("Managed-cloud WhatsApp delivery adapter is not connected"),
      });
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("delivery-status returns real recorded status or explicit not-found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-phylax-api-delivery-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" };
    try {
      runtime.whatsappStore.recordOutboundAudit({
        messageId: "mailbox-1",
        chatId: "34611111111@s.whatsapp.net",
        contactId: "34611111111@s.whatsapp.net",
        bodyText: "Mentor: hello",
        status: "sent",
        sentMessageId: "wamid.real.1",
      });

      const found = await app.request("/api/phylax/delivery-status", {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: "whatsapp", sentMessageId: "wamid.real.1" }),
      });
      expect(found.status).toBe(200);
      await expect(found.json()).resolves.toMatchObject({
        ok: true,
        channel: "whatsapp",
        sentMessageId: "wamid.real.1",
        status: "sent",
        messageId: "mailbox-1",
      });

      const missing = await app.request("/api/phylax/delivery-status", {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: "whatsapp", sentMessageId: "wamid.missing" }),
      });
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({ ok: false, code: "not_found" });
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
