import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { githubAppInstallationUrl } from "./github-connect"

describe("GitHub repository connection", () => {
  const installationUrl =
    "https://github.com/apps/zenod-memory-v01a/installations/new"

  it("accepts the shared app installation URL returned by the API", () => {
    expect(githubAppInstallationUrl({ url: installationUrl })).toBe(
      installationUrl
    )
  })

  it("accepts compatible installation URL payloads", () => {
    expect(githubAppInstallationUrl({ installationUrl: installationUrl })).toBe(
      installationUrl
    )
    expect(githubAppInstallationUrl({ action: installationUrl })).toBe(
      installationUrl
    )
  })

  it("never accepts the GitHub App manifest creation flow", () => {
    expect(() =>
      githubAppInstallationUrl({
        action: "https://github.com/settings/apps/new",
        manifest: { name: "customer-created-app" },
      })
    ).toThrow("invalid repository connection URL")
  })

  it("rejects missing and non-GitHub redirect URLs", () => {
    expect(() => githubAppInstallationUrl({})).toThrow(
      "did not return a repository connection URL"
    )
    expect(() =>
      githubAppInstallationUrl({
        url: "https://example.com/apps/zenod/installations/new",
      })
    ).toThrow("invalid repository connection URL")
  })

  it("presents repository selection without claiming it creates an app", () => {
    const source = readFileSync(
      new URL("./github-connect.tsx", import.meta.url),
      "utf8"
    )

    expect(source).toContain("Connect repository")
    expect(source).toContain("Select repository")
    expect(source).not.toContain("creates a private GitHub App")
    expect(source).not.toContain("settings/apps/new")
  })
})
