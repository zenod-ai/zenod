export function extractHostedAccessToken(hash: string): string | null {
  if (!hash.startsWith("#")) return null
  const token = new URLSearchParams(hash.slice(1)).get("access_token")?.trim()
  return token || null
}
