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
        // ZAL-A19: the not-found page the server sends with HTTP 404.
        notfound: path.resolve(__dirname, "404.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
