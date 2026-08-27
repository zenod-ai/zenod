import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __PHYLAX_WEB_BUILD_ID__: JSON.stringify(
      process.env.PHYLAX_WEB_BUILD_ID ?? String(Date.now()),
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../web/src"),
      "@phylax": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/auth": "http://localhost:8080",
    },
  },
});
