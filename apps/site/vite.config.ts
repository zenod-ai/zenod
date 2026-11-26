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
      // for crawlers and directory reviewers; testers.html (ZAL-A13) carries the
      // testers program's. All pages share src/main.tsx.
      input: {
        main: path.resolve(__dirname, "index.html"),
        connect: path.resolve(__dirname, "connect.html"),
        testers: path.resolve(__dirname, "testers.html"),
        // E26-S26: the video and WhatsApp how-to page testers are sent to.
        start: path.resolve(__dirname, "start.html"),
        // E25-S5: the Vision tab, its own title and description for links.
        vision: path.resolve(__dirname, "vision.html"),
        // ZAL-A19: the not-found page the server sends with HTTP 404.
        notfound: path.resolve(__dirname, "404.html"),
        // E7-S42: /pricing with its own title and canonical, and three pages
        // that answer what people search for: what Zenod Memory is, vs Basic
        // Memory and Mem0, Zenod is not Zenodo.
        pricing: path.resolve(__dirname, "pricing.html"),
        "zenod-memory": path.resolve(__dirname, "zenod-memory.html"),
        "zenod-vs-basic-memory-mem0": path.resolve(__dirname, "zenod-vs-basic-memory-mem0.html"),
        "zenod-vs-zenodo": path.resolve(__dirname, "zenod-vs-zenodo.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
