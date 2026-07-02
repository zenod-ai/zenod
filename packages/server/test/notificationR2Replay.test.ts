import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NotificationBus } from "../src/notificationBus.js";
import { NotificationStore } from "../src/notificationStore.js";

/**
 * R2-T6 — replay of the recorded 2026-07-01 idea_scraper#102 event stream through the
 * single notification authority, proving the epic's done-condition: the storm of
 * duplicate/contradictory/truncated messages collapses to a handful of coherent ones.
 *
 * Recorded reality (from the WhatsApp transcript): 3 sibling executions on #102, each
 * announced blocked (needs-host-access), then one PR #107 terminal broadcast per
 * sibling — ~10 messages, blocked question cut mid-word, ✅ after ⛔ with no
 * explanation. After R2-T1..T4 this must become one blocked + one terminal, the
 * blocker question intact, and the terminal explaining the prior block.
 */
describe("R2 replay — idea_scraper#102 notification storm", () => {
  const TARGET = "AlfaBlok/idea_scraper#102";
  const FULL_QUESTION =
    "⛔ Blocked — needs your decision\n\nThis fan-out worker is not the VPS container: no SSH route to hetzner_vps_1, no bot secrets (TELEGRAM/OPENROUTER/OPENAI/PG/DuckDB path all unset), no docker/Dokploy, and warehouse_read.duckdb is absent. How should the agent be given host access?";

  it("collapses the storm to one blocked + one (explained) terminal, question intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-r2-replay-"));
    const store = new NotificationStore(join(dir, "notifications.sqlite"));
    try {
      const sent: string[] = [];
      let clock = 1_000_000;
      // The send fans out to BOTH owner recipients centrally (one call → 2 recipients),
      // so the caller never expands the recipient set itself.
      const bus = new NotificationBus(
        async (_surface, text) => {
          sent.push(text);
          return { sent: 2, recipients: ["34618217703@s.whatsapp.net", "34664240219@s.whatsapp.net"] };
        },
        store,
        () => clock,
      );

      const execs = ["direct-a", "direct-b", "direct-c"];

      // Mirror the runner's real content-aware keys: blocked keys on the question,
      // terminal keys on the shared PR evidence (all three siblings → same PR #107).
      const PR = "https://github.com/AlfaBlok/idea_scraper/pull/107";
      const blockedKey = `${TARGET}|${FULL_QUESTION.slice(0, 120)}|execution.blocked`;
      const terminalKey = `${TARGET}|${PR}|execution.terminal`;

      // 1) Each sibling execution reports blocked with the SAME full question.
      for (const executionId of execs) {
        clock += 1000;
        await bus.notify({ eventType: "execution.blocked", text: FULL_QUESTION, targetIssue: TARGET, executionId, severity: "action", dedupeKey: blockedKey });
      }
      // 2) Then each sibling reports the PR #107 terminal.
      for (const executionId of execs) {
        clock += 1000;
        await bus.notify({
          eventType: "execution.terminal",
          text: `✅ Ready for review: ${TARGET}\nState: PR open — NOT merged yet.\n${PR}`,
          targetIssue: TARGET,
          executionId,
          severity: "info",
          dedupeKey: terminalKey,
        });
      }

      // Done-condition: ≤4 messages actually sent (here exactly 2 — one blocked, one terminal).
      expect(sent.length).toBeLessThanOrEqual(4);
      expect(sent).toHaveLength(2);

      // The blocker question is complete — the "(TELEGRAM/…)" clause is not cut.
      expect(sent[0]).toContain("(TELEGRAM/OPENROUTER/OPENAI/PG/DuckDB path all unset)");

      // The terminal references the prior block instead of a bare ✅ after ⛔.
      expect(sent[1]).toContain("Previously blocked — now resolved");
      expect(sent[1]).toContain("pull/107");

      // The journal shows the coalesced/ordered truth: 2 sent, 4 suppressed.
      const records = store.recent();
      expect(records.filter((r) => r.status === "sent")).toHaveLength(2);
      expect(records.filter((r) => r.status === "suppressed")).toHaveLength(4);
      // Every suppressed row points at the record that superseded it.
      expect(records.filter((r) => r.status === "suppressed").every((r) => Boolean(r.suppressedBy))).toBe(true);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
