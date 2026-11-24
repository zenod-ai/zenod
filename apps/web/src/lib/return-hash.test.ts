// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { keepReturnHash, restoreReturnHash } from "./return-hash"

describe("E7-S35 note link survives sign-in", () => {
  afterEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState(null, "", "/")
  })

  it("keeps a note link through the sign-in round trip and puts it back once", () => {
    const hash = "#memory?path=Log%2F2026-11-24.md%23%5Ee-798779"
    window.history.replaceState(null, "", `/${hash}`)
    keepReturnHash()
    window.history.replaceState(null, "", "/")
    restoreReturnHash()
    expect(window.location.hash).toBe(hash)
    window.history.replaceState(null, "", "/")
    restoreReturnHash()
    expect(window.location.hash).toBe("")
  })

  it("ignores other hashes and never overrides a hash already there", () => {
    window.history.replaceState(null, "", "/#settings/usage")
    keepReturnHash()
    expect(window.sessionStorage.getItem("zenod.returnHash")).toBeNull()
    window.sessionStorage.setItem("zenod.returnHash", "#memory?path=a")
    window.history.replaceState(null, "", "/#chat")
    restoreReturnHash()
    expect(window.location.hash).toBe("#chat")
  })
})
