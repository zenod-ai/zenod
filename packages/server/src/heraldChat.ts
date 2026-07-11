import {
  HERALD_DEFAULT_PROPOSAL_COUNT,
  HERALD_MIN_CADENCE_MINUTES,
  type HeraldBoardItem,
  type HeraldBriefing,
  type HeraldBriefingContent,
  type HeraldBriefingDraft,
  type HeraldFiling,
  type HeraldMutationReceipt,
} from "./heraldLoop.js";
import { callPeerWithArgs, type PeerConfig } from "./peerClient.js";

export interface HeraldChatInput {
  tenantId: string;
  text: string;
}

export interface HeraldChatResult {
  handled: boolean;
  text?: string;
}

export interface HeraldMemoryFilingInput {
  tenantId: string;
  kind: "briefing" | "proposal_rejection" | "proposal_outcome";
  content: string;
  memoryCitation?: string;
}

export type HeraldFileToMemory = (input: HeraldMemoryFilingInput) => Promise<string>;

export interface HeraldChatDependencies {
  getApprovedBriefing(tenantId: string): HeraldBriefing | null;
  getBriefingDraft(tenantId: string): HeraldBriefingDraft | null;
  saveBriefingDraft(
    tenantId: string,
    patch: Partial<Pick<HeraldBriefingDraft,
      "theme" | "objectives" | "cadenceMinutes" | "proposalCount" | "tone" | "replyPolicy">>,
  ): HeraldBriefingDraft;
  clearBriefingDraft(tenantId: string): HeraldMutationReceipt;
  approveBriefing(input: {
    tenantId: string;
    content: HeraldBriefingContent;
    cadenceMinutes: number;
    proposalCount?: number;
  }): { briefing: HeraldBriefing; receipt: HeraldMutationReceipt };
  listProposed(tenantId: string): HeraldBoardItem[];
  decideItems(
    tenantId: string,
    input: { approveIds: string[]; rejectIds: string[] },
  ): HeraldMutationReceipt;
  recordFiling(input: Omit<HeraldFiling, "id" | "createdAt">): {
    filing: HeraldFiling;
    receipt: HeraldMutationReceipt;
  };
  fileToMemory: HeraldFileToMemory;
}

export interface HeraldApprovalSelection {
  approveIndexes: number[];
  rejectIndexes: number[];
}

const EXACT_BRIEFING_APPROVAL = "✓ approve briefing";

function joinIndexes(indexes: number[]): string {
  if (indexes.length === 0) return "none";
  if (indexes.length === 1) return String(indexes[0]);
  return `${indexes.slice(0, -1).join(", ")} and ${indexes.at(-1)}`;
}

export function parseHeraldApproval(text: string, proposalCount: number): HeraldApprovalSelection | null {
  const normalized = text.trim();
  if (!normalized.startsWith("✓") || proposalCount < 1) return null;
  if (/^✓\s*all\s*$/i.test(normalized)) {
    return {
      approveIndexes: Array.from({ length: proposalCount }, (_, index) => index + 1),
      rejectIndexes: [],
    };
  }
  const match = normalized.match(/^✓\s*(\d+(?:\s*,\s*\d+)*)\s*(?:\+\s*reject\s+the\s+rest)?\s*$/i);
  if (!match) return null;
  const approveIndexes = [...new Set(match[1]!.split(",").map((value) => Number(value.trim())))];
  if (approveIndexes.some((index) => !Number.isInteger(index) || index < 1 || index > proposalCount)) return null;
  return {
    approveIndexes,
    rejectIndexes: Array.from({ length: proposalCount }, (_, index) => index + 1)
      .filter((index) => !approveIndexes.includes(index)),
  };
}

function nextMissingField(draft: HeraldBriefingDraft): "theme" | "objectives" | "cadence" | "tone" | "replyPolicy" | null {
  if (!draft.theme) return "theme";
  if (draft.objectives.length === 0) return "objectives";
  if (draft.cadenceMinutes === null) return "cadence";
  if (!draft.tone) return "tone";
  if (!draft.replyPolicy) return "replyPolicy";
  return null;
}

function questionFor(field: NonNullable<ReturnType<typeof nextMissingField>>): string {
  switch (field) {
    case "theme": return "What theme should Herald consistently speak about?";
    case "objectives": return "What objectives should the posts advance? Separate multiple objectives with commas.";
    case "cadence": return "What posting cadence should Herald use? For example: daily, hourly, or every 30 minutes. You can also say how many proposals per wake, such as “3 posts daily”.";
    case "tone": return "What tone should Herald use?";
    case "replyPolicy": return "What is the reply policy? Describe when Herald should reply and when it should stay silent.";
  }
}

function parseObjectives(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((value) => value.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function parseCadence(text: string): { cadenceMinutes: number; proposalCount?: number } | null {
  const normalized = text.trim().toLowerCase();
  let cadenceMinutes: number | null = null;
  if (/\b(?:daily|every\s+day)\b/.test(normalized)) cadenceMinutes = 24 * 60;
  else if (/\b(?:hourly|every\s+hour)\b/.test(normalized)) cadenceMinutes = 60;
  else {
    const interval = normalized.match(/(?:every\s+)?(\d+)\s*(minutes?|mins?|hours?|hrs?)/);
    if (interval) cadenceMinutes = Number(interval[1]) * (/^h/.test(interval[2]!) ? 60 : 1);
  }
  if (cadenceMinutes === null) return null;
  const countMatch = normalized.match(/\b(\d+)\s+(?:posts?|proposals?)(?:\s+per\s+wake)?\b/);
  return {
    cadenceMinutes: Math.max(HERALD_MIN_CADENCE_MINUTES, cadenceMinutes),
    ...(countMatch ? { proposalCount: Number(countMatch[1]) } : {}),
  };
}

function renderDraft(draft: HeraldBriefingDraft, version: number): string {
  return [
    `Briefing v${version} ready for approval:`,
    `Theme: ${draft.theme}`,
    `Objectives: ${draft.objectives.join("; ")}`,
    `Cadence: every ${draft.cadenceMinutes} minutes; ${draft.proposalCount ?? HERALD_DEFAULT_PROPOSAL_COUNT} proposals per wake`,
    `Tone: ${draft.tone}`,
    `Reply policy: ${draft.replyPolicy}`,
    `Reply exactly “${EXACT_BRIEFING_APPROVAL}” to commit it. Herald will not loop before that exact approval.`,
  ].join("\n");
}

function requireCommitReceipt(receipt: string): string {
  const normalized = receipt.trim();
  if (
    !/\bcommit(?:\s+sha)?\s*:\s*[0-9a-f]{7,64}\b/i.test(normalized) ||
    /\b(?:failed|could not|timed out|error)\b/i.test(normalized)
  ) {
    throw new Error(`Zenod returned no verified commit receipt: ${normalized || "empty response"}`);
  }
  return normalized;
}

function briefingContent(draft: HeraldBriefingDraft): HeraldBriefingContent {
  return {
    theme: draft.theme!,
    objectives: draft.objectives,
    tone: draft.tone!,
    replyPolicy: draft.replyPolicy!,
  };
}

function loudError(error: unknown): HeraldChatResult {
  return {
    handled: true,
    text: `Herald action failed loudly; no success is claimed. ERROR: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function isPrematureLoopAction(text: string): boolean {
  return /^(?:run now|wake(?: now)?|start (?:the )?loop|propose now|publish(?: now)?|post now)$/i.test(text.trim()) ||
    (/^✓/.test(text.trim()) && text.trim() !== EXACT_BRIEFING_APPROVAL);
}

export function createHeraldChatHandler(dependencies: HeraldChatDependencies) {
  return async ({ tenantId, text }: HeraldChatInput): Promise<HeraldChatResult> => {
    const message = text.trim();
    const approved = dependencies.getApprovedBriefing(tenantId);

    if (!approved) {
      let draft = dependencies.getBriefingDraft(tenantId);
      if (!draft) {
        draft = dependencies.saveBriefingDraft(tenantId, {});
        return {
          handled: true,
          text: `Briefing setup started. No loop action can run before approval.\n${questionFor("theme")}`,
        };
      }

      const missing = nextMissingField(draft);
      if (message === EXACT_BRIEFING_APPROVAL) {
        if (missing) {
          return { handled: true, text: `Briefing approval refused: ${missing} is still missing. ${questionFor(missing)}` };
        }
        const version = 1;
        const filingContent = renderDraft(draft, version);
        try {
          const commitReceipt = requireCommitReceipt(await dependencies.fileToMemory({
            tenantId,
            kind: "briefing",
            content: filingContent,
          }));
          const committed = dependencies.approveBriefing({
            tenantId,
            content: briefingContent(draft),
            cadenceMinutes: draft.cadenceMinutes!,
            proposalCount: draft.proposalCount ?? undefined,
          });
          const filing = dependencies.recordFiling({
            tenantId,
            kind: "briefing",
            content: filingContent,
            memoryCitation: null,
            commitReceipt,
          });
          const cleared = dependencies.clearBriefingDraft(tenantId);
          return {
            handled: true,
            text: [
              committed.receipt.message,
              commitReceipt,
              filing.receipt.message,
              cleared.message,
            ].join("\n"),
          };
        } catch (error) {
          return loudError(error);
        }
      }

      if (!missing) {
        return { handled: true, text: renderDraft(draft, 1) };
      }
      if (!message) return { handled: true, text: questionFor(missing) };
      if (isPrematureLoopAction(message)) {
        return {
          handled: true,
          text: `Loop action refused: no approved briefing. Nothing changed.\n${questionFor(missing)}`,
        };
      }

      if (missing === "cadence") {
        const cadence = parseCadence(message);
        if (!cadence) {
          return { handled: true, text: `Cadence not captured; no state changed. ${questionFor("cadence")}` };
        }
        draft = dependencies.saveBriefingDraft(tenantId, cadence);
      } else if (missing === "theme") {
        draft = dependencies.saveBriefingDraft(tenantId, { theme: message });
      } else if (missing === "objectives") {
        const objectives = parseObjectives(message);
        if (objectives.length === 0) return { handled: true, text: questionFor("objectives") };
        draft = dependencies.saveBriefingDraft(tenantId, { objectives });
      } else if (missing === "tone") {
        draft = dependencies.saveBriefingDraft(tenantId, { tone: message });
      } else {
        draft = dependencies.saveBriefingDraft(tenantId, { replyPolicy: message });
      }

      const next = nextMissingField(draft);
      return next
        ? { handled: true, text: `Briefing draft receipt: captured ${missing}.\n${questionFor(next)}` }
        : { handled: true, text: `Briefing draft receipt: captured ${missing}.\n${renderDraft(draft, 1)}` };
    }

    if (!message.startsWith("✓")) return { handled: false };
    const proposals = dependencies.listProposed(tenantId);
    if (proposals.length === 0) {
      return { handled: true, text: "Nothing changed: there are no current proposed items to approve." };
    }
    const selection = parseHeraldApproval(message, proposals.length);
    if (!selection) {
      return {
        handled: true,
        text: `I could not parse that approval, so nothing changed. Use “✓ 1,3”, “✓ all”, or “✓ 2 + reject the rest” against the current ${proposals.length}-item list.`,
      };
    }

    const approveItems = selection.approveIndexes.map((index) => proposals[index - 1]!);
    const rejectItems = selection.rejectIndexes.map((index) => proposals[index - 1]!);
    const echo = `Approving ${joinIndexes(selection.approveIndexes)}, rejecting ${joinIndexes(selection.rejectIndexes)}.`;
    try {
      let memoryReceipt: string | null = null;
      let filingReceipt: HeraldMutationReceipt | null = null;
      if (rejectItems.length > 0) {
        const content = [
          `Herald proposal decision: rejected current items ${joinIndexes(selection.rejectIndexes)}.`,
          ...rejectItems.map((item, index) => `Rejected ${selection.rejectIndexes[index]!}: ${item.text}\nWhy it was proposed: ${item.rationale}\nSource: ${item.memoryCitation}`),
        ].join("\n\n");
        memoryReceipt = requireCommitReceipt(await dependencies.fileToMemory({
          tenantId,
          kind: "proposal_rejection",
          content,
          memoryCitation: rejectItems.map((item) => item.memoryCitation).join(", "),
        }));
        filingReceipt = dependencies.recordFiling({
          tenantId,
          kind: "proposal_rejection",
          content,
          memoryCitation: rejectItems.map((item) => item.memoryCitation).join(", "),
          commitReceipt: memoryReceipt,
        }).receipt;
      }
      const decision = dependencies.decideItems(tenantId, {
        approveIds: approveItems.map((item) => item.id),
        rejectIds: rejectItems.map((item) => item.id),
      });
      if (decision.status !== "ok") throw new Error(`${decision.code}: ${decision.message}`);
      return {
        handled: true,
        text: [echo, decision.message, memoryReceipt, filingReceipt?.message].filter(Boolean).join("\n"),
      };
    } catch (error) {
      return loudError(error);
    }
  };
}

export function createZenodWalletFiler(
  listWalletPeers: (tenantId: string) => readonly PeerConfig[],
  callTool: typeof callPeerWithArgs = callPeerWithArgs,
): HeraldFileToMemory {
  return async ({ tenantId, kind, content, memoryCitation }) => {
    const zenod = listWalletPeers(tenantId).find((peer) =>
      peer.wallet === true && (
        peer.name.trim().toLowerCase() === "zenod" ||
        peer.tools?.some((tool) => tool.mcp === "store_memory")
      ),
    );
    if (!zenod) throw new Error("No tenant Zenod memory entry is connected in the wallet.");
    return callTool(zenod, "store_memory", {
      content,
      verbatim: true,
      hints: [
        `Herald filing: ${kind}`,
        ...(memoryCitation ? [`Source memory: ${memoryCitation}`] : []),
      ],
    });
  };
}
