import { isPeerToolsReady, type Peer } from "./peer-agents-model"

export type RingPeerStatus =
  | "connected"
  | "disconnected"
  | "disabled"
  | "unhealthy"
  | "missing-token"

export function ringPeerStatus(
  peer: Peer | undefined,
  teamEnabled: boolean
): RingPeerStatus {
  if (peer && !peer.hasToken) return "missing-token"
  if (isPeerToolsReady(peer)) return "connected"
  if (peer) return "unhealthy"
  return teamEnabled ? "disconnected" : "disabled"
}
