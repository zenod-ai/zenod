import assert from "node:assert/strict";
import test from "node:test";

import { NAME_PREFIX, parseArgs, tenantKeyName, tenantKeys } from "./gateway/openrouter-key.mjs";

test("parseArgs reads --flag value pairs", () => {
  assert.deepEqual(parseArgs(["--tenant", "acme", "--limit", "50"]), { tenant: "acme", limit: "50" });
});

test("parseArgs throws on a malformed flag rather than misparsing", () => {
  assert.throws(() => parseArgs(["tenant", "acme"]), /unexpected argument/);
});

test("tenantKeyName round-trips with the prefix filter", () => {
  const name = tenantKeyName("acme");
  assert.equal(name, `${NAME_PREFIX}acme`);
  const [row] = tenantKeys([{ name, hash: "h1", limit: 50, usage: 3.5 }]);
  assert.equal(row.tenant, "acme");
});

test("tenantKeys keeps only keys this tool minted and projects them", () => {
  const rows = tenantKeys([
    { name: `${NAME_PREFIX}acme`, hash: "h1", limit: 50, usage: 3.5, disabled: false },
    { name: "someone-elses-key", hash: "h2", limit: 10, usage: 1 },
    { name: `${NAME_PREFIX}beta`, hash: "h3", disabled: true },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { tenant: "acme", hash: "h1", limit: 50, usage: 3.5, disabled: false });
  // Missing limit/usage/disabled default sanely (not NaN/undefined).
  assert.deepEqual(rows[1], { tenant: "beta", hash: "h3", limit: null, usage: 0, disabled: true });
});
