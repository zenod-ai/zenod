# Safe classifier diagnostics

Bound issue [ZMR-8 #1196](https://github.com/zenod-ai/zenod/issues/1196). Base `a5eada1`; worktree `wt-zmr-classify-diagnostics`, branch `codex/zmr-classify-diagnostics`.

Production recorded two `structured_output_invalid` failures and preserved the capture in Inbox. This code does not infer the invalid field, relax the classification schema, change the model/provider, or claim filing is repaired. The next already-authorized live attempt can report why structured generation failed without another separate model probe.

The classifier failure path now logs a bounded `[classify]` JSON diagnostic containing only allowlisted finish reasons, error kinds, issue codes and schema field names. Array indices are replaced by `[]`; unknown names are redacted; at most five causes, eight issues and eight path components are included. Raw output, validation values, error messages and credentials are excluded. The thrown classifier error is also a stable safe code. Other operations' error behavior is unchanged.

For `NoObjectGeneratedError`, SDK-reported input/output usage is forwarded to the existing failed-attempt meter instead of discarded. Missing provider usage remains unavailable under the existing metering contract; this change does not estimate costs or claim a failed response was free.

Validation (no live API/model/production calls):

- 10 focused tests passed: safe diagnostics, adversarial redaction, cycle/size bounds, actual SDK structured failure usage, provider-error safety, and existing schema/fence compatibility.
- Existing engine raw-save/Inbox fallback regression passed: two failed classifications retain the original capture and redact provider error prose (1 selected test, 72 skipped).
- Core typecheck and whitespace checks passed.
