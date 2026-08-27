import { readFile } from "node:fs/promises";

const [metafilePath, bundlePath] = process.argv.slice(2);
if (!metafilePath || !bundlePath) {
  throw new Error("usage: assert-phylax-bundle.mjs <metafile.json> <bundle.js>");
}

const metafile = JSON.parse(await readFile(metafilePath, "utf8"));
const inputs = Object.keys(metafile.inputs ?? {});
const forbiddenRuntimeInputs = [
  "app.ts",
  "drive.ts",
  "driveTools.ts",
  "mcp.ts",
  "runtime.ts",
  "voiceArchive.ts",
  "zenodUnit.ts",
];
const reached = forbiddenRuntimeInputs.filter((path) =>
  inputs.some((input) => input === path || input.endsWith(`/src/${path}`) || input === `src/${path}`)
);
if (reached.length > 0) {
  throw new Error(`Phylax bundle reached forbidden Zenod runtime modules: ${reached.join(", ")}`);
}

const allowedCoreInputs = new Set([
  "conversation.ts",
  "evidenceContext.ts",
  "state/sqlite.ts",
  "version.ts",
]);
const reachedCoreInputs = inputs
  .filter((input) => input.includes("/core/src/"))
  .map((input) => input.split("/core/src/")[1]);
const forbiddenCoreInputs = reachedCoreInputs.filter((input) => !allowedCoreInputs.has(input));
if (forbiddenCoreInputs.length > 0) {
  throw new Error(`Phylax bundle reached forbidden Zenod core modules: ${forbiddenCoreInputs.join(", ")}`);
}

const bundle = await readFile(bundlePath, "utf8");
for (const symbol of ["createZenodUnit", "ZenodRuntimePool", "registerZenodTools"]) {
  if (bundle.includes(symbol)) {
    throw new Error(`Phylax bundle contains forbidden Zenod runtime symbol: ${symbol}`);
  }
}
if (/\bfrom\s+["']zenod(?:\/|["'])|\bimport\(["']zenod(?:\/|["'])/.test(bundle)) {
  throw new Error("Phylax bundle retains an external Zenod runtime import");
}

console.log(`Phylax-only bundle verified (${inputs.length} reachable source/dependency inputs).`);
