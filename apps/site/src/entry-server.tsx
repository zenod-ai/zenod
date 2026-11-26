// E7-S42: the build renders every page to plain HTML once (scripts/prerender.mjs),
// so Google and AI crawlers read the headings and words without running script.
// The browser then takes the same markup over (src/main.tsx).
import { StrictMode } from "react"
import { renderToString } from "react-dom/server"

import App from "./App"

export function render(path: string): string {
  return renderToString(
    <StrictMode>
      <App path={path} />
    </StrictMode>
  )
}
