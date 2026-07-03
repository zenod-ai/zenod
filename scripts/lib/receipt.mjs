/**
 * Authority receipt — acceptance test 5: "emitted unchanged, OUTSIDE the framework."
 *
 * This mirrors the production discipline in packages/server/src/outboundReceipt.ts:
 * honesty is STRUCTURAL, not a model disposition. The execution substrate (whatever
 * it is — Eve, Flue, or this DIY loop) produces the WORK; the authority independently
 * reduces that work to ONE of two verified shapes and emits the receipt. The substrate
 * is never free to author its own "done" claim.
 *
 * The whole point of putting this in its own module, with no import of the executor,
 * is to prove the receipt does not depend on the framework: swap the substrate and
 * this function is unchanged.
 */

/**
 * @param {object} outcome  The substrate's raw result: { runId, status, summary?, error?, evidence? }
 * @returns {object} receipt  Exactly one of the two verified shapes.
 */
export function emitAuthorityReceipt(outcome) {
  const base = { kind: "execution-receipt", runId: outcome.runId };
  if (outcome.status === "completed" && outcome.summary && outcome.evidence?.length) {
    // verified=true only with a real summary AND concrete evidence the work happened.
    return { ...base, verified: true, status: "completed", summary: outcome.summary, evidence: outcome.evidence };
  }
  // Every non-completed (or unsubstantiated) outcome is a verbatim, verified failure.
  return {
    ...base,
    verified: false,
    status: outcome.status || "failed",
    reason: outcome.error || "run did not complete with substantiating evidence",
  };
}

/** Render the receipt to a single user-facing line — a pure function of the receipt. */
export function renderReceipt(receipt) {
  if (receipt.verified) {
    return `✓ ${receipt.runId} completed — ${receipt.summary} (${receipt.evidence.length} evidence step(s))`;
  }
  return `✗ ${receipt.runId} ${receipt.status} — ${receipt.reason}`;
}
