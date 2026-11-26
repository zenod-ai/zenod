import { StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { registerWebMcpTools } from "./lib/webmcp"
import { countPageLoad } from "./lib/counter"

registerWebMcpTools(new AbortController().signal)
countPageLoad()

// E7-S42: pages arrive prerendered (scripts/prerender.mjs); take that markup over
// instead of drawing it again. A page without it (vite dev) is drawn fresh.
const root = document.getElementById("root")!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)
if (root.hasChildNodes()) hydrateRoot(root, app)
else createRoot(root).render(app)
