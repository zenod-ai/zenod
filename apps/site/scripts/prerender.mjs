// E7-S42: write each page's HTML into its file's empty #root, so crawlers get
// real headings and words (before: 2 to 3 KB shells filled by script).
// Runs after `vite build` and `vite build --ssr src/entry-server.tsx`.
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, "../dist")
const ssrDir = resolve(here, "../dist-ssr")

// file in dist -> the address it is served at (packages/server/src/staticSurfaces.ts)
const PAGES = JSON.parse(readFileSync(resolve(here, "pages.json"), "utf8"))

const { render } = await import(pathToFileURL(resolve(ssrDir, "entry-server.js")).href)
const EMPTY_ROOT = '<div id="root"></div>'
for (const [file, path] of Object.entries(PAGES)) {
  const target = resolve(dist, file)
  const page = readFileSync(target, "utf8")
  if (!page.includes(EMPTY_ROOT)) throw new Error(`${file}: no empty #root to fill`)
  const html = render(path)
  if (!/<h1[\s>]/.test(html)) throw new Error(`${file}: rendered page has no h1`)
  writeFileSync(target, page.replace(EMPTY_ROOT, `<div id="root">${html}</div>`))
  console.log(`prerendered ${file} (${path}): ${html.length} chars`)
}
rmSync(ssrDir, { recursive: true, force: true })
