import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rekeyChassisDataDir, type ChassisRekeyReport } from "@zenod/mcp-chassis";
import { rekeyZenodPhylaxAdapterTokens, type ZenodPhylaxTokenRekeyReport } from "./zenodPhylax.js";

/**
 * Offline rotation of CHASSIS_VAULT_MASTER_KEY for a Zenod data dir. Run with the unit stopped:
 *
 *   node packages/server/dist/vaultRekey.js verify   # every ciphertext opens under CHASSIS_VAULT_MASTER_KEY
 *   node packages/server/dist/vaultRekey.js rekey    # re-seal from CHASSIS_VAULT_MASTER_KEY_PREVIOUS
 *
 * Keys come only from the environment; the output is counts only. Exit 0 only when every
 * ciphertext decrypts under the new key and none is unaccounted for.
 */
export interface VaultRekeyReport {
  mode: "verify" | "rekey";
  dataDir: string;
  chassis: ChassisRekeyReport;
  phylaxTokens: ZenodPhylaxTokenRekeyReport;
  ok: boolean;
}

export function runVaultRekey(input: {
  mode: "verify" | "rekey";
  dataDir: string;
  key: string;
  previousKey?: string;
}): VaultRekeyReport {
  if (input.mode === "rekey" && !input.previousKey) {
    throw new Error("rekey requires CHASSIS_VAULT_MASTER_KEY_PREVIOUS");
  }
  if (input.previousKey && input.previousKey.trim() === input.key.trim()) {
    throw new Error("CHASSIS_VAULT_MASTER_KEY_PREVIOUS must differ from CHASSIS_VAULT_MASTER_KEY");
  }
  const previousKey = input.mode === "rekey" ? input.previousKey : undefined;
  const chassis = rekeyChassisDataDir({
    dataDir: input.dataDir,
    key: input.key,
    ...(previousKey ? { previousKey } : {}),
  });
  // Any chassis failure (including an unaccounted envelope, which aborts before writing) leaves
  // the adapter tokens as they are: verify only, so a rollback restores one consistent key.
  const phylaxTokens = rekeyZenodPhylaxAdapterTokens(
    input.dataDir,
    input.key,
    chassis.failed ? undefined : previousKey,
  );
  return {
    mode: input.mode,
    dataDir: input.dataDir,
    chassis,
    phylaxTokens,
    ok: chassis.failed === 0
      && chassis.verified === chassis.envelopes
      && phylaxTokens.failed === 0
      && phylaxTokens.verified === phylaxTokens.tokens,
  };
}

function main(argv: string[], env: NodeJS.ProcessEnv): number {
  const mode = argv[0];
  if (mode !== "verify" && mode !== "rekey") {
    console.error("usage: vaultRekey.js verify|rekey [--data-dir <dir>]");
    return 2;
  }
  const dirFlag = argv.indexOf("--data-dir");
  const dataDir = resolve(
    (dirFlag >= 0 ? argv[dirFlag + 1] : undefined) ?? env.ZENOD_DATA_DIR ?? env.DATA_DIR ?? "/data",
  );
  const key = env.CHASSIS_VAULT_MASTER_KEY?.trim();
  if (!key) {
    console.error("CHASSIS_VAULT_MASTER_KEY is required");
    return 2;
  }
  const previousKey = env.CHASSIS_VAULT_MASTER_KEY_PREVIOUS?.trim() || undefined;
  const report = runVaultRekey({ mode, dataDir, key, ...(previousKey ? { previousKey } : {}) });
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2), process.env);
  } catch (error) {
    // Messages are fixed strings from the rekey code; never a key or plaintext.
    console.error(error instanceof Error ? error.message : "vault rekey failed");
    process.exitCode = 1;
  }
}
