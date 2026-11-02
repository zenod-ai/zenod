import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: "/site/",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // connect.html carries the /connect guide's own title and description
      // for crawlers and directory reviewers; both pages share src/main.tsx.
      input: {
        main: path.resolve(__dirname, "index.html"),
        connect: path.resolve(__dirname, "connect.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
