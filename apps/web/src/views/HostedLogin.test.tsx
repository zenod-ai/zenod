// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { HostedLogin } from "./HostedLogin"

afterEach(cleanup)

describe("Hosted Google-first login", () => {
  it("offers configured Google and GitHub sign-in with separate storage consent copy", () => {
    render(<HostedLogin methods={["google", "github"]} />)

    expect(
      screen
        .getByRole("link", { name: "Continue with Google" })
        .getAttribute("href")
    ).toBe("/auth/google/start")
    expect(
      screen
        .getByRole("link", { name: "Continue with GitHub" })
        .getAttribute("href")
    ).toBe("/auth/github/start")
    expect(
      screen.getByText(/Sign-in uses only your basic profile and email/i)
    ).not.toBeNull()
    expect(
      screen.getByText(/separate permission after checkout/i)
    ).not.toBeNull()
  })

  it("does not advertise an identity provider that is not configured", () => {
    render(<HostedLogin methods={["google"]} />)

    expect(
      screen.getByRole("link", { name: "Continue with Google" })
    ).not.toBeNull()
    expect(
      screen.queryByRole("link", { name: "Continue with GitHub" })
    ).toBeNull()
  })
})
