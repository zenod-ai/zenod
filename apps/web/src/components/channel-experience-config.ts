import type { ChannelExperience } from "@/components/channel-experience"

export const ZENOD_CHANNEL_EXPERIENCE: ChannelExperience = {
  product: "zenod",
  eyebrow: "Channels",
  title: "Talk to Zenod anywhere",
  description: "Every connected channel reaches this tenant memory directly.",
  customerSafe: true,
  destinationVisible: false,
}

export const PM_CHANNEL_EXPERIENCE: ChannelExperience = {
  product: "pm",
  eyebrow: "Channels",
  title: "Talk to your PM on WhatsApp",
  description: "Every connected channel reaches this PM workspace directly.",
  customerSafe: true,
  destinationVisible: false,
}

export const PHYLAX_CHANNEL_EXPERIENCE: ChannelExperience = {
  product: "phylax",
  eyebrow: "Connections",
  title: "Your agents on WhatsApp and Telegram",
  description:
    "Connect verified identities to one compatible agent destination.",
  customerSafe: false,
  destinationVisible: true,
}
