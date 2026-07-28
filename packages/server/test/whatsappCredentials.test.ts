import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BufferJSON } from "@whiskeysockets/baileys";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWhatsAppCredentialSaveQueue,
  prepareWhatsAppCredentials,
  restoreWhatsAppCredentials,
} from "../src/whatsappGateway.js";

const roots: string[] = [];

function credentials(registrationId: number): Buffer {
  const keyPair = (seed: number) => ({
    public: Buffer.alloc(32, seed),
    private: Buffer.alloc(32, seed + 1),
  });
  return Buffer.from(JSON.stringify({
    registrationId,
    noiseKey: keyPair(1),
    pairingEphemeralKeyPair: keyPair(3),
    signedIdentityKey: keyPair(5),
    signedPreKey: {
      keyPair: keyPair(7),
      signature: Buffer.alloc(64, 9),
      keyId: 1,
    },
    advSecretKey: Buffer.alloc(32, 10).toString("base64"),
    firstUnuploadedPreKeyId: 1,
    nextPreKeyId: 1,
    processedHistoryMessages: [],
    accountSyncCounter: 0,
    accountSettings: { unarchiveChats: false },
    registered: true,
  }, BufferJSON.replacer));
}

function modifiedCredentials(
  registrationId: number,
  modify: (parsed: Record<string, unknown>) => void,
): Buffer {
  const parsed = JSON.parse(credentials(registrationId).toString("utf8"), BufferJSON.reviver) as Record<string, unknown>;
  modify(parsed);
  return Buffer.from(JSON.stringify(parsed, BufferJSON.replacer));
}

async function sessionDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phylax-whatsapp-creds-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WhatsApp credential durability", () => {
  it("restores a protected backup only when the primary is empty", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), "");
    await writeFile(join(dir, "creds.last-known-good.json"), credentials(41));

    await expect(restoreWhatsAppCredentials(dir)).resolves.toBe(true);
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toContain('"registrationId":41');
    expect((await stat(join(dir, "creds.json"))).mode & 0o777).toBe(0o600);
  });

  it("restores a valid backup over syntactically valid but partial primary JSON", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), JSON.stringify({
      registrationId: 40,
      noiseKey: {},
    }));
    await writeFile(join(dir, "creds.last-known-good.json"), credentials(41));

    await expect(restoreWhatsAppCredentials(dir)).resolves.toBe(true);
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toContain('"registrationId":41');
  });

  it("restores over wrong-length keys and rejects malformed base64 secrets", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), modifiedCredentials(40, (parsed) => {
      (parsed.noiseKey as Record<string, unknown>).public = Buffer.alloc(1);
    }));
    await writeFile(join(dir, "creds.last-known-good.json"), credentials(41));

    await expect(restoreWhatsAppCredentials(dir)).resolves.toBe(true);
    await writeFile(join(dir, "creds.json"), modifiedCredentials(42, (parsed) => {
      parsed.advSecretKey = "not-base64";
    }));
    await writeFile(join(dir, "creds.last-known-good.json"), "");
    await writeFile(join(dir, "session-owner.0.json"), "{}");
    await expect(prepareWhatsAppCredentials(dir)).rejects.toThrow("credentials are corrupt");
  });

  it("never overwrites a valid primary with an older backup", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), credentials(42));
    await writeFile(join(dir, "creds.last-known-good.json"), credentials(12));

    await expect(restoreWhatsAppCredentials(dir)).resolves.toBe(false);
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toContain('"registrationId":42');
  });

  it("seeds a protected backup before opening an existing valid session", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), credentials(44));
    await chmod(dir, 0o755);

    await expect(prepareWhatsAppCredentials(dir)).resolves.toBe("ready");
    await expect(readFile(join(dir, "creds.last-known-good.json"), "utf8")).resolves.toContain(
      '"registrationId":44',
    );
    expect((await stat(join(dir, "creds.last-known-good.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "creds.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("fails closed when companion keys exist without a valid primary or backup", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), "");
    await writeFile(join(dir, "session-owner.0.json"), "{}");

    await expect(prepareWhatsAppCredentials(dir)).rejects.toThrow(
      "credentials are corrupt and no valid backup is available",
    );
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toBe("");
  });

  it("fails closed when both primary and backup are partial in a populated session", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), '{"registrationId":40,"noiseKey":{}}');
    await writeFile(join(dir, "creds.last-known-good.json"), '{"registrationId":41,"noiseKey":{}}');
    await writeFile(join(dir, "session-owner.0.json"), "{}");

    await expect(prepareWhatsAppCredentials(dir)).rejects.toThrow(
      "credentials are corrupt and no valid backup is available",
    );
  });

  it("allows first pairing in a directory without companion credential material", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), "");

    await expect(prepareWhatsAppCredentials(dir)).resolves.toBe("new");
  });

  it("restores a valid backup before accepting a populated companion-key directory", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), "");
    await writeFile(join(dir, "creds.last-known-good.json"), credentials(43));
    await writeFile(join(dir, "session-owner.0.json"), "{}");

    await expect(prepareWhatsAppCredentials(dir)).resolves.toBe("restored");
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toContain('"registrationId":43');
  });

  it("serializes overlapping updates and flushes the whole chain", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), credentials(1));
    let active = 0;
    let maxActive = 0;
    let nextRegistration = 1;
    const saveCreds = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      nextRegistration += 1;
      await writeFile(join(dir, "creds.json"), credentials(nextRegistration));
      active -= 1;
    });
    const queue = createWhatsAppCredentialSaveQueue(dir, saveCreds);

    queue.enqueue();
    queue.enqueue();
    queue.enqueue();
    await queue.flush();

    expect(saveCreds).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toContain('"registrationId":4');
    await expect(readFile(join(dir, "creds.last-known-good.json"), "utf8")).resolves.toContain(
      '"registrationId":4',
    );
  });

  it("extends an in-progress flush to credential updates accepted while it waits", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), credentials(1));
    const releaseFirst = vi.fn<() => void>();
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst.mockImplementation(resolve);
    });
    let nextRegistration = 1;
    const saveCreds = vi.fn(async () => {
      nextRegistration += 1;
      if (nextRegistration === 2) await firstSave;
      await writeFile(join(dir, "creds.json"), credentials(nextRegistration));
    });
    const queue = createWhatsAppCredentialSaveQueue(dir, saveCreds);

    queue.enqueue();
    const flushing = queue.flush();
    queue.enqueue();
    releaseFirst();
    await flushing;

    expect(saveCreds).toHaveBeenCalledTimes(2);
    await expect(readFile(join(dir, "creds.last-known-good.json"), "utf8")).resolves.toContain(
      '"registrationId":3',
    );
  });

  it("restores the previous primary and reports an invalid save", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), credentials(77));
    const observed: unknown[] = [];
    const queue = createWhatsAppCredentialSaveQueue(
      dir,
      async () => {
        await writeFile(join(dir, "creds.json"), "");
      },
      (error) => observed.push(error),
    );

    queue.enqueue();
    await expect(queue.flush()).rejects.toThrow("invalid primary");
    expect(observed).toHaveLength(1);
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toContain('"registrationId":77');
  });

  it("restores the previous primary when a direct save truncates and throws", async () => {
    const dir = await sessionDir();
    await writeFile(join(dir, "creds.json"), credentials(88));
    const queue = createWhatsAppCredentialSaveQueue(dir, async () => {
      await writeFile(join(dir, "creds.json"), "");
      throw new Error("simulated interrupted write");
    });

    queue.enqueue();
    await expect(queue.flush()).rejects.toThrow("simulated interrupted write");
    await expect(readFile(join(dir, "creds.json"), "utf8")).resolves.toContain('"registrationId":88');
  });
});
