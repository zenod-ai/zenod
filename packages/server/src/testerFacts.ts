// EPIC-7 E7-S40 (Jordi, chat voice note vn_febcc8c2, 25 Nov 15:22Z: "how is it possible that we're making these totally
// ridiculous errors ... We've had problems with these email addresses for a long time ... when they registered, we didn't
// get their names"; trace agent_team E105-S305). One place decides the address and the name a mail to a tester uses, and
// says where each came from, so the team's mail tool (gmail_send, which holds outside mail without these facts) and the
// people reading the queue can check them:
//   address: the address they signed in to Zenod with first (Google or GitHub, kept on the account as github_email for
//            history), the one typed at payment checkout only when the account has no sign-in address;
//   name:    the first name they typed on their tester application, joined to the account by the code it redeemed
//            (never by matching addresses), and the name their Google sign-in gave, kept on the account with its source.
//            Both and they differ: unsure, no name. Neither: missing, no name.
// A mail whose facts are missing or unsure is held by the sender (scripts/tester-thanks/send.py), never guessed.
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { CONTACT_FROM_SIGNIN, type CustomerAccount } from "./customerAccounts.js";

export const ADDRESS_FROM_SIGNIN = CONTACT_FROM_SIGNIN;
export const ADDRESS_FROM_CHECKOUT = "the address they typed at payment checkout (no sign-in address on the account)";
export { CONTACT_FROM_GITHUB, CONTACT_FROM_GOOGLE } from "./customerAccounts.js";
export const NAME_FROM_APPLICATION = "the first name they typed on their tester application (joined by the code they redeemed)";
export const NAME_FROM_GOOGLE = "the name on their Google sign-in";

/** What the team's mail tool needs to send to someone outside (agent_team E105-S305 `facts`), plus what is not sure. */
export interface MailFacts {
  address_from: string;
  name?: string;
  name_from?: string;
  /** Facts that are missing or not sure; the sender holds the mail while any is listed. */
  missing?: string[];
}

export interface PersonFacts {
  address: string | null;
  address_from: string | null;
  /** The first name the greeting uses ("Hi Ana,"); null greets "Hi,". */
  name: string | null;
  name_from: string | null;
  /** Each fact that is missing or unsure, in plain words; empty when every fact is sure. */
  missing: string[];
  /** Every name found, with where it came from (for the evidence page and the logs). */
  names: Array<{ name: string; from: string }>;
}

const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** A first name worth greeting with: one plain word, else none ("Hi,"). */
export function greetingName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'-]{1,29}$/u.test(first) ? first.charAt(0).toUpperCase() + first.slice(1) : null;
}

/**
 * The name a Google sign-in gave, or null when Google gave none (Zenod falls back to the address or "Google user" for
 * the display name; neither is a name).
 */
export function signinNameFromDisplay(displayName: string | null | undefined, email?: string | null): string | null {
  const name = (displayName ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name || name === "Google user" || name.includes("@")) return null;
  if (email && name.toLowerCase() === email.trim().toLowerCase()) return null;
  return name;
}

/** The address a mail to this account goes to and where it came from: the sign-in address first. */
export function accountAddress(account: CustomerAccount): { address: string; from: string } | null {
  // E7-S40: the person's one kept address (their Google sign-in) first.
  const contact = account.contact_email?.trim() ?? "";
  if (EMAIL.test(contact)) return { address: contact, from: account.contact_email_from?.trim() || CONTACT_FROM_SIGNIN };
  const signin = account.github_email?.trim() ?? "";
  if (EMAIL.test(signin)) return { address: signin, from: ADDRESS_FROM_SIGNIN };
  const checkout = account.stripe_email?.trim() ?? "";
  if (EMAIL.test(checkout)) return { address: checkout, from: ADDRESS_FROM_CHECKOUT };
  return null;
}

/** E7-S40: the sign-in address before the checkout one (3 of Daniel's 5 mails went to the address typed at checkout). */
export function accountEmail(account: CustomerAccount): string | null {
  return accountAddress(account)?.address ?? null;
}

export interface TesterCodeRecord {
  email: string;
  redeemedBy?: string;
}
export interface ApplicationRecord {
  contact?: unknown;
  name?: unknown;
}

/**
 * The first name typed on the application whose code this account redeemed (flow.redeemed_by), never by matching the
 * account's addresses: Nox applied with one address and signed in with another, and the name was lost.
 */
export function applicationNameByCode(accountId: string, testers: TesterCodeRecord[], applications: ApplicationRecord[]): string | null {
  const tester = testers.find((entry) => entry.redeemedBy === accountId);
  if (!tester) return null;
  const key = tester.email.trim().toLowerCase();
  const application = applications
    .filter((entry) => typeof entry.contact === "string" && entry.contact.trim().toLowerCase() === key && typeof entry.name === "string" && entry.name.trim())
    .pop();
  return typeof application?.name === "string" ? application.name.trim() : null;
}

/** The address and name a mail to this tester uses, each with where it came from. */
export function personFacts(account: CustomerAccount, applicationName: string | null): PersonFacts {
  const address = accountAddress(account);
  const missing: string[] = [];
  if (!address) missing.push("address: the account has no sign-in or checkout address");
  // One address per person, the sign-in one: a checkout address alone is billing only, never written to.
  else if (address.from === ADDRESS_FROM_CHECKOUT) missing.push("address: no sign-in address kept, only the one typed at payment checkout");
  const names: Array<{ name: string; from: string }> = [];
  if (applicationName?.trim()) names.push({ name: applicationName.trim(), from: NAME_FROM_APPLICATION });
  if (account.signin_name?.trim()) names.push({ name: account.signin_name.trim(), from: account.signin_name_from?.trim() || NAME_FROM_GOOGLE });
  const firsts = names.map((entry) => ({ ...entry, first: greetingName(entry.name) })).filter((entry) => entry.first);
  let name: string | null = null;
  let nameFrom: string | null = null;
  const distinct = new Set(firsts.map((entry) => entry.first!.toLowerCase()));
  if (firsts.length === 0) {
    missing.push(names.length ? `name: "${names[0]!.name}" does not read as a first name` : "name: none typed on the application and none from the sign-in");
  } else if (distinct.size > 1) {
    missing.push(`name: unsure, ${firsts.map((entry) => `"${entry.first}" from ${entry.from}`).join(" but ")}`);
  } else {
    name = firsts[0]!.first;
    nameFrom = firsts.map((entry) => entry.from).join(" and ");
  }
  return { address: address?.address ?? null, address_from: address?.from ?? null, name, name_from: nameFrom, missing, names };
}

/**
 * The facts a queued mail carries for the sender and gmail_send. A mail whose approved words greet with "Hi," and no name
 * (usesName false) needs only the address; a missing or unsure name does not hold it.
 */
export function mailFacts(facts: PersonFacts, usesName = true): MailFacts {
  const missing = usesName ? facts.missing : facts.missing.filter((line) => !line.startsWith("name:"));
  return {
    address_from: facts.address_from ?? "",
    ...(usesName && facts.name ? { name: facts.name, name_from: facts.name_from ?? "" } : {}),
    ...(missing.length ? { missing } : {}),
  };
}

/** Masked, for evidence and logs: "da…@gmail.com". */
export function maskAddress(address: string | null): string | null {
  if (!address) return null;
  const [user = "", domain = ""] = address.split("@");
  return `${user.slice(0, 2)}…@${domain}`;
}

export interface TesterFactsRouteOptions {
  isOps: (c: Context) => boolean;
  accounts: () => CustomerAccount[];
  isTester: (account: CustomerAccount) => boolean;
  isTest: (account: CustomerAccount) => boolean;
  facts: (account: CustomerAccount) => PersonFacts;
  vaultSet: (account: CustomerAccount) => boolean;
  now?: () => number;
}

/**
 * E7-S40, ops token only: per real tester, the address and the name a mail now uses and where each came from, masked
 * (never a full address, never a phone number). GET /api/ops/testers/facts.
 */
export function mountTesterFactsRoute(app: Hono<{ Bindings: HttpBindings }>, options: TesterFactsRouteOptions): void {
  app.get("/api/ops/testers/facts", (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const testers = options.accounts()
      .filter((account) => account.tenant_id && account.subscription_status !== "checkout_pending" && account.subscription_status !== "canceled"
        && options.isTester(account) && !options.isTest(account))
      .map((account) => {
        const facts = options.facts(account);
        const checkout = account.stripe_email?.trim() || null;
        return {
          key: account.account_id.slice(-4),
          signedUpAt: account.claimed_at,
          address: maskAddress(facts.address),
          address_from: facts.address_from,
          checkoutAddress: checkout && checkout.toLowerCase() !== facts.address?.toLowerCase() ? maskAddress(checkout) : null,
          name: facts.name,
          name_from: facts.name_from,
          names: facts.names,
          missing: facts.missing,
          storageConnected: options.vaultSet(account),
        };
      });
    return c.json({ generatedAt: new Date(options.now?.() ?? Date.now()).toISOString(), testers });
  });
}
