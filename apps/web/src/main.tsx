import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import "./zenod-ui.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { countCompletedSignup } from "@/lib/signup-counter"
import { installClientErrorReporting } from "@/lib/client-errors"

declare const __ZENOD_WEB_BUILD_ID__: string

document.documentElement.dataset.zenodBuild = __ZENOD_WEB_BUILD_ID__
countCompletedSignup()
installClientErrorReporting()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
