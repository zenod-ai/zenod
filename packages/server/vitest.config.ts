import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Resolve the workspace dependency from source so tests don't require a prior build.
      {
        find: "zenod/evidence-context",
        replacement: fileURLToPath(new URL("../core/src/evidenceContext.ts", import.meta.url)),
      },
      {
        find: "zenod/state/sqlite",
        replacement: fileURLToPath(new URL("../core/src/state/sqlite.ts", import.meta.url)),
      },
      {
        find: "zenod/version",
        replacement: fileURLToPath(new URL("../core/src/version.ts", import.meta.url)),
      },
      {
        find: /^zenod$/,
        replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      },
    ],
  },
});
