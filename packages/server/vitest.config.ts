import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace dependency from source so tests don't require a prior build.
      zenod: fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
