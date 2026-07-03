/**
 * Hard per-run budget ceiling — acceptance test 4.
 *
 * This is the gap flagged in the D-2 landscape doc (§3.3): a runaway agent must be
 * TERMINATED, not merely warned. The ceiling lives OUTSIDE the model loop (like the
 * receipt) so it holds regardless of what the model does. Every token charge is
 * checked against the ceiling; the first charge that would exceed it throws
 * `BudgetExceededError`, which the executor turns into a terminal, receipted failure.
 */
export class BudgetExceededError extends Error {
  constructor(spent, ceiling) {
    super(`hard budget ceiling exceeded: spent ${spent} > ceiling ${ceiling} tokens`);
    this.name = "BudgetExceededError";
    this.spent = spent;
    this.ceiling = ceiling;
  }
}

export class Budget {
  constructor(ceilingTokens) {
    this.ceiling = ceilingTokens;
    this.spent = 0;
  }

  /** Charge usage. Throws (terminates the run) the moment the ceiling is crossed. */
  charge(tokens) {
    this.spent += tokens;
    if (this.spent > this.ceiling) throw new BudgetExceededError(this.spent, this.ceiling);
    return this.spent;
  }

  get remaining() { return Math.max(0, this.ceiling - this.spent); }
}
