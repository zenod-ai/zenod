import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { registerWebMcpTools } from "./lib/webmcp"
import { countPageLoad } from "./lib/counter"

registerWebMcpTools(new AbortController().signal)
countPageLoad()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
