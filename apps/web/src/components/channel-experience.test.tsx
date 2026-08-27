// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  ChannelControlGrid,
  ChannelExperienceFrame,
  PHYLAX_CHANNEL_EXPERIENCE,
  PM_CHANNEL_EXPERIENCE,
  PmChannelsContractFixture,
  ZENOD_CHANNEL_EXPERIENCE,
} from "./channel-experience"

afterEach(cleanup)

describe("integrated-independent channel UI contract", () => {
  it.each([ZENOD_CHANNEL_EXPERIENCE, PM_CHANNEL_EXPERIENCE])(
    "$product integrated shell is customer-safe and hides destination controls",
    (experience) => {
      const { container } = render(
        <ChannelExperienceFrame experience={experience}>
          <ChannelControlGrid
            controls={[
              {
                id: "whatsapp",
                label: "WhatsApp",
                state: "connected",
                identityHint: "+34 6•• ••• •••",
                description: "Included channel",
              },
            ]}
          />
        </ChannelExperienceFrame>
      )
      const shell = container.querySelector("[data-channel-product]")
      expect(shell?.getAttribute("data-customer-safe")).toBe("true")
      expect(shell?.getAttribute("data-destination-visible")).toBe("false")
      expect(container.textContent).not.toMatch(
        /Phylax|OpenRouter|provider|bearer|token|internal allocation|downstream|MCP URL/i
      )
    }
  )

  it("keeps native Phylax as the only customer shell that exposes one destination", () => {
    const { container } = render(
      <ChannelExperienceFrame experience={PHYLAX_CHANNEL_EXPERIENCE}>
        <p>One agent destination</p>
      </ChannelExperienceFrame>
    )
    const shell = container.querySelector("[data-channel-product='phylax']")
    expect(shell?.getAttribute("data-customer-safe")).toBe("false")
    expect(shell?.getAttribute("data-destination-visible")).toBe("true")
    expect(screen.getByText("One agent destination")).not.toBeNull()
  })

  it("keeps PM as a fixture with PM-owned copy and no service internals", () => {
    const { container } = render(<PmChannelsContractFixture />)
    expect(screen.getByText("Talk to your PM on WhatsApp")).not.toBeNull()
    expect(container.textContent).not.toMatch(
      /Phylax|Zenod|OpenRouter|provider|bearer|token|downstream|MCP URL/i
    )
  })

  it.each([360, 736, 1024])(
    "uses bounded responsive grids at %ipx",
    (width) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      })
      const { container } = render(<PmChannelsContractFixture />)
      expect(container.querySelector(".min-w-0")).not.toBeNull()
      expect(container.querySelector(".md\\:grid-cols-2")).not.toBeNull()
      expect(container.querySelector(".overflow-x-auto")).toBeNull()
    }
  )
})
