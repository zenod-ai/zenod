import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { FIVE_THINGS, StartPage, START_POSTER_SRC, START_VIDEO_SRC } from "@/components/start-page"

describe("zenod.dev/start", () => {
  const html = renderToStaticMarkup(<StartPage nav={null} footer={null} />)

  it("shows the heading, the video and its poster", () => {
    expect(html).toContain("Start with Zenod in one minute")
    expect(html).toContain(`src="${START_VIDEO_SRC}"`)
    expect(html).toContain(`poster="${START_POSTER_SRC}"`)
    expect(html).toContain("controls")
    expect(html).toMatch(/playsinline/i)
  })

  it("lists the five things and the WhatsApp how-to", () => {
    expect(FIVE_THINGS).toHaveLength(5)
    for (const item of FIVE_THINGS) expect(html).toContain(item.title)
    expect(html).toContain("Create one-time code")
    expect(html).toContain("cloud.zenod.dev/app")
    expect(html).toContain("jordi@zenod.dev")
  })

  it("ships its own title and canonical URL and the video files", () => {
    const page = readFileSync(new URL("./start.html", import.meta.url), "utf8")
    expect(page).toContain('<link rel="canonical" href="https://zenod.dev/start" />')
    expect(page).toContain("<title>Start with Zenod in one minute</title>")
    for (const file of ["zenod-start.mp4", "zenod-start.jpg"]) {
      expect(readFileSync(new URL(`./public/start/${file}`, import.meta.url)).length).toBeGreaterThan(1000)
    }
  })
})
