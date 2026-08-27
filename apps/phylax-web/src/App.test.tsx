// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  App,
  PhylaxCustomerShell,
  PhylaxOperatorShell,
  PhylaxSignIn,
} from "./App";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr") },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("dedicated Phylax shells", () => {
  it("renders a Phylax-only anonymous sign-in with no Zenod product copy", () => {
    const { container } = render(<PhylaxSignIn />);
    expect(screen.getByRole("heading", { name: "Phylax" })).not.toBeNull();
    expect(container.textContent).not.toMatch(/Zenod|vault|memory repo/i);
  });

  it.each([360, 736, 1024])(
    "keeps the native customer shell bounded at %ipx",
    (width) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      const { container } = render(
        <PhylaxCustomerShell
          me={{ login: "alpha", avatar_url: "" }}
          account={null}
        />,
      );
      expect(container.querySelector(".max-w-6xl")).not.toBeNull();
      expect(container.querySelector("nav.grid-cols-3")).not.toBeNull();
      expect(container.textContent).not.toMatch(/Zenod|PM workspace/i);
    },
  );

  it("keeps operator controls on the explicit owner shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/api/whatsapp/status")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                state: "connected",
                linkedNumber: "+34600",
                qr: null,
                lastActivity: null,
                lastError: null,
              }),
              { status: 200 },
            ),
          );
        }
        if (path.endsWith("/api/telegram/status")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                state: "connected",
                botUsername: "phylax",
                lastActivity: null,
                lastError: null,
              }),
              { status: 200 },
            ),
          );
        }
        if (path.endsWith("/api/phylax/admin/metering")) {
          return Promise.resolve(
            new Response(JSON.stringify({ tenants: [] }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );
    const { container } = render(<PhylaxOperatorShell />);
    expect(await screen.findByText("+34600")).not.toBeNull();
    expect(
      container.querySelector("[data-owner-surface='true']"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: /Re-pair/i })).not.toBeNull();
    expect(screen.getByText("No metered tenant periods yet.")).not.toBeNull();
  });

  it("does not render the operator shell on a product route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
          }),
        ),
      ),
    );
    window.history.replaceState(null, "", "/app");
    const { container } = render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Sign in with GitHub")).not.toBeNull(),
    );
    expect(container.querySelector("[data-owner-surface='true']")).toBeNull();
  });
});
