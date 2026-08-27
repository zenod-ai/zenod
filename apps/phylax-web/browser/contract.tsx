import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  ChannelControlGrid,
  ChannelExperienceFrame,
  PHYLAX_CHANNEL_EXPERIENCE,
  PM_CHANNEL_EXPERIENCE,
  ZENOD_CHANNEL_EXPERIENCE,
  type ChannelControl,
} from "@/components/channel-experience";
import { HostedUsageCard } from "@/components/hosted-usage-card";
import { PhylaxOperatorShell, PhylaxSignIn } from "../src/App";
import "../src/index.css";

const connectedControls: ChannelControl[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    state: "connected",
    identityHint: "+34 6•• ••• •••",
    description: "Ready for private conversations.",
  },
  {
    id: "telegram",
    label: "Telegram",
    state: "off",
    identityHint: null,
    description: "Connect one private identity.",
  },
];

export function CustomerFixture({
  product,
}: {
  product: "zenod" | "pm" | "phylax";
}) {
  const experience =
    product === "zenod"
      ? ZENOD_CHANNEL_EXPERIENCE
      : product === "pm"
        ? PM_CHANNEL_EXPERIENCE
        : PHYLAX_CHANNEL_EXPERIENCE;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <ChannelExperienceFrame experience={experience}>
        {product === "phylax" ? (
          <p className="border border-border p-3 text-sm">
            One compatible agent destination: agent.example/mcp
          </p>
        ) : null}
        <ChannelControlGrid controls={connectedControls} />
        <HostedUsageCard
          productName={
            product === "pm"
              ? "Your PM"
              : product === "zenod"
                ? "Zenod"
                : "Phylax"
          }
          compact
          usage={{
            percentageUsed: 18,
            state: "normal",
            resetsAt: "2026-09-01T00:00:00.000Z",
          }}
        />
      </ChannelExperienceFrame>
    </main>
  );
}

function installOperatorFixture() {
  window.fetch = async (input) => {
    const path = String(input);
    if (path.endsWith("/api/whatsapp/status")) {
      return Response.json({
        state: "connected",
        linkedNumber: "+34 600 000 000",
        qr: null,
        lastActivity: null,
        lastError: null,
      });
    }
    if (path.endsWith("/api/telegram/status")) {
      return Response.json({
        state: "connected",
        botUsername: "phylax_gateway",
        lastActivity: null,
        lastError: null,
      });
    }
    if (path.endsWith("/api/phylax/admin/metering")) {
      return Response.json({ tenants: [] });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
}

const shell =
  new URLSearchParams(window.location.search).get("shell") ?? "phylax";
if (shell === "operator") installOperatorFixture();

const view =
  shell === "anonymous" ? (
    <PhylaxSignIn />
  ) : shell === "operator" ? (
    <PhylaxOperatorShell />
  ) : (
    <CustomerFixture
      product={shell === "zenod" || shell === "pm" ? shell : "phylax"}
    />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{view}</StrictMode>,
);
