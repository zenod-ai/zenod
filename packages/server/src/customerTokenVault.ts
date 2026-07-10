import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface TokenEnvelope {
  version: 1;
  iv: string;
  ciphertext: string;
  authTag: string;
}

type Store = Record<string, TokenEnvelope>;

export class CustomerTokenVault {
  readonly path: string;
  private readonly key: Buffer | null;

  constructor(dataDir: string, secret: string) {
    this.path = join(dataDir, "customer-token-bindings.json");
    this.key = secret ? createHash("sha256").update(secret, "utf8").digest() : null;
  }

  get(accountId: string): string | null {
    if (!this.key) return null;
    const envelope = this.load()[accountId];
    if (!envelope || envelope.version !== 1) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return null;
    }
  }

  put(accountId: string, token: string): void {
    if (!this.key) throw new Error("customer token vault secret is not configured");
    if (!accountId || !token) throw new Error("account id and token are required");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const store = this.load();
    store[accountId] = {
      version: 1,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const pendingPath = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(pendingPath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(pendingPath, this.path);
  }

  private load(): Store {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Store;
    } catch {
      return {};
    }
  }
}
