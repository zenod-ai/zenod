export type PeerTool = {
  name: string
  mcpName: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  outputSchemaError?: string
  annotations?: Record<string, unknown>
}

export type PeerSkill = {
  artifactId: string
  version: string
  name: string
  description: string
  createdAt: string
  totalBytes: number
  files: Array<{
    path: string
    size: number
    sha256: string
    executable: false
  }>
  scriptsInert: true
}

export type Peer = {
  name: string
  url: string
  hasToken: boolean
  transportStatus: "connected" | "error"
  toolsStatus: "ready" | "error"
  toolsError?: string
  refreshedAt?: string
  toolCount: number
  tools: PeerTool[]
  skill: PeerSkill | null
}

export type SkillFileInput = {
  path: string
  content?: string
  contentBase64?: string
}

type DownloadedSkillBundle = {
  format: "zenod-agent-skill-bundle-v1"
  files: Array<{ path: string; contentBase64: string }>
}

export function peerFromResponse(
  peers: Peer[],
  name: string
): Peer | undefined {
  return peers.find((peer) => peer.name === name)
}

export function isPeerToolsReady(peer: Peer | undefined): boolean {
  return Boolean(
    peer?.hasToken &&
    peer.transportStatus === "connected" &&
    peer.toolsStatus === "ready" &&
    peer.toolCount > 0
  )
}

export function replacePeer(peers: Peer[], replacement: Peer): Peer[] {
  return peers.map((peer) =>
    peer.name === replacement.name ? replacement : peer
  )
}

export function setPeerSkill(
  peers: Peer[],
  peerName: string,
  skill: PeerSkill | null
): Peer[] {
  return peers.map((peer) =>
    peer.name === peerName ? { ...peer, skill } : peer
  )
}

export function nextOperationGeneration(
  generations: Map<string, number>,
  peerName: string
): number {
  const next = (generations.get(peerName) ?? 0) + 1
  generations.set(peerName, next)
  return next
}

export function isCurrentOperation(
  generations: Map<string, number>,
  peerName: string,
  generation: number
): boolean {
  return generations.get(peerName) === generation
}

export async function skillFilesFromSelection(
  files: File[]
): Promise<SkillFileInput[]> {
  if (files.length !== 1 || !files[0]!.name.endsWith(".json")) {
    throw new Error("Choose one downloaded .skill.json bundle.")
  }
  const parsed = JSON.parse(
    await files[0]!.text()
  ) as Partial<DownloadedSkillBundle>
  if (
    parsed.format !== "zenod-agent-skill-bundle-v1" ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("Choose one downloaded .skill.json bundle.")
  }
  return parsed.files.map((file) => {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.contentBase64 !== "string"
    ) {
      throw new Error("The Agent Skill bundle is malformed.")
    }
    return { path: file.path, contentBase64: file.contentBase64 }
  })
}
