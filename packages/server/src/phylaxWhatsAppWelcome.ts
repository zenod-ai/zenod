// EPIC-26 E26-S26 (Jordi's yes on E26-A14, 2026-11-14: "Yes: build and switch it on"): the moment a
// tester links WhatsApp, the one reply Zenod sends is a thank-you with a link to the 60-second video at
// zenod.dev/start, in place of "Your WhatsApp number is verified. Return to Zenod to finish setup."
//
// Phylax stays a carrier: Zenod (the commercial owner) decides who gets it and arms it when it asks for
// the one-time code (`welcome: "tester"` on channel_connect); a code asked without it disarms. The
// verification consumes the arm, so the welcome goes once per arm and a repeated code sends nothing new.
// The text is fixed here, so the management surface never becomes a send-any-message primitive.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PHYLAX_WHATSAPP_WELCOME_FILE = "whatsapp-welcome.json";
/** An arm older than this is ignored: a code is only good for minutes, a day is generous. */
export const WHATSAPP_WELCOME_ARM_TTL_MS = 24 * 60 * 60 * 1000;
export const ZENOD_START_URL = "https://zenod.dev/start";

export type PhylaxWelcomeKind = "tester";

/** The one WhatsApp message a tester gets when their number links (proposal E26-S22, section 2). */
export const ZENOD_WHATSAPP_TESTER_WELCOME = [
  "Your WhatsApp is linked. Thank you for testing Zenod!",
  "",
  "Here is a 1-minute video of five things to try first:",
  ZENOD_START_URL,
  "",
  "Then send me your first voice note, right here.",
].join("\n");

interface WelcomeState {
  tenants: Record<string, { kind: PhylaxWelcomeKind; armedAt: number }>;
}

export class PhylaxWhatsAppWelcome {
  private readonly path: string;

  constructor(private readonly dataDir: string) {
    this.path = join(dataDir, PHYLAX_WHATSAPP_WELCOME_FILE);
  }

  private read(): WelcomeState {
    if (!existsSync(this.path)) return { tenants: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<WelcomeState>;
      return { tenants: parsed.tenants && typeof parsed.tenants === "object" ? parsed.tenants : {} };
    } catch {
      return { tenants: {} };
    }
  }

  private write(state: WelcomeState): void {
    mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, this.path);
  }

  /** Arm (kind) or disarm (null) the welcome for this tenant's next WhatsApp verification. */
  set(tenantId: string, kind: PhylaxWelcomeKind | null, now = Date.now()): void {
    const state = this.read();
    if (kind) state.tenants[tenantId] = { kind, armedAt: now };
    else if (state.tenants[tenantId]) delete state.tenants[tenantId];
    else return;
    this.write(state);
  }

  /** The welcome text for this verification, consuming the arm; null when none is armed (or it is stale). */
  take(tenantId: string, now = Date.now()): string | null {
    const state = this.read();
    const entry = state.tenants[tenantId];
    if (!entry) return null;
    delete state.tenants[tenantId];
    this.write(state);
    if (now - entry.armedAt > WHATSAPP_WELCOME_ARM_TTL_MS) return null;
    return entry.kind === "tester" ? ZENOD_WHATSAPP_TESTER_WELCOME : null;
  }
}
