import type * as React from "react"
import { CheckCircle2Icon, MessageCircleIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PM_CHANNEL_EXPERIENCE } from "@/components/channel-experience-config"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type ChannelProduct = "zenod" | "pm" | "phylax"
export type ChannelState =
  | "off"
  | "awaiting_code"
  | "connected"
  | "degraded"
  | "paused"

export type ChannelExperience = {
  product: ChannelProduct
  eyebrow: string
  title: string
  description: string
  customerSafe: boolean
  destinationVisible: boolean
}

export type ChannelControl = {
  id: "whatsapp" | "telegram"
  label: string
  state: ChannelState
  identityHint: string | null
  description: string
  onConnect?: () => void
  onTest?: () => void
  onDisconnect?: () => void
}

export {
  PHYLAX_CHANNEL_EXPERIENCE,
  PM_CHANNEL_EXPERIENCE,
  ZENOD_CHANNEL_EXPERIENCE,
} from "@/components/channel-experience-config"

function stateLabel(state: ChannelState): string {
  if (state === "awaiting_code") return "Awaiting code"
  if (state === "connected") return "Connected"
  if (state === "degraded") return "Needs attention"
  if (state === "paused") return "Paused"
  return "Not connected"
}

export function ChannelExperienceFrame({
  experience,
  children,
}: {
  experience: ChannelExperience
  children: React.ReactNode
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      data-channel-product={experience.product}
      data-customer-safe={experience.customerSafe ? "true" : "false"}
      data-destination-visible={
        experience.destinationVisible ? "true" : "false"
      }
    >
      <header className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">
          {experience.eyebrow}
        </p>
        <h2 className="text-xl font-semibold text-balance sm:text-2xl">
          {experience.title}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {experience.description}
        </p>
      </header>
      {children}
    </section>
  )
}

/**
 * Pure, controller-driven channel card shared by host-product fixtures and the
 * native Phylax shell. It receives only customer-safe projections; authority,
 * service credentials and transport diagnostics never enter this component.
 */
export function ChannelControlCard({ control }: { control: ChannelControl }) {
  const connected = control.state === "connected"
  return (
    <Card className="min-w-0 rounded-none" data-channel={control.id}>
      <CardHeader>
        <MessageCircleIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex flex-wrap items-center gap-2">
          {control.label}
          <Badge
            variant={
              control.state === "degraded" || control.state === "paused"
                ? "destructive"
                : connected
                  ? "secondary"
                  : "outline"
            }
          >
            {connected ? <CheckCircle2Icon /> : null}
            {stateLabel(control.state)}
          </Badge>
        </CardTitle>
        <CardDescription>{control.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm break-words text-muted-foreground">
          {control.identityHint ?? "No identity linked yet."}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {control.state === "off" && control.onConnect ? (
          <Button type="button" onClick={control.onConnect}>
            Connect
          </Button>
        ) : null}
        {control.state !== "off" && control.onTest ? (
          <Button type="button" variant="outline" onClick={control.onTest}>
            Send test
          </Button>
        ) : null}
        {control.state !== "off" && control.onDisconnect ? (
          <Button type="button" variant="ghost" onClick={control.onDisconnect}>
            Disconnect
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}

export function ChannelControlGrid({
  controls,
}: {
  controls: ChannelControl[]
}) {
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      {controls.map((control) => (
        <ChannelControlCard key={control.id} control={control} />
      ))}
    </div>
  )
}

export function PmChannelsContractFixture() {
  return (
    <ChannelExperienceFrame experience={PM_CHANNEL_EXPERIENCE}>
      <ChannelControlGrid
        controls={[
          {
            id: "whatsapp",
            label: "WhatsApp",
            state: "connected",
            identityHint: "+34 6•• ••• •••",
            description: "Included with this PM workspace.",
          },
          {
            id: "telegram",
            label: "Telegram",
            state: "off",
            identityHint: null,
            description: "Connect one private PM identity.",
          },
        ]}
      />
    </ChannelExperienceFrame>
  )
}
