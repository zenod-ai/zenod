const PREFIX = "zenod.hosted-channel.operation."
const LEGACY_PHONE_KEY = `${PREFIX}whatsapp.sender`

type StoredOperation = {
  id: string
  revision: string
  targetFingerprint: string | null
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function createKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function hostedChannelOperationKey(
  operation: string,
  revision: string,
  target?: string,
  reset = false
): Promise<string> {
  const key = `${PREFIX}${operation}`
  const targetFingerprint =
    target === undefined
      ? undefined
      : Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(target.trim().toLowerCase())
            )
          ),
          (byte) => byte.toString(16).padStart(2, "0")
        ).join("")
  const raw = reset ? null : storage()?.getItem(key)
  if (raw) {
    try {
      const current = JSON.parse(raw) as StoredOperation
      if (
        current.id &&
        current.revision === revision &&
        (targetFingerprint === undefined ||
          current.targetFingerprint === targetFingerprint)
      )
        return current.id
    } catch {
      if (
        targetFingerprint === undefined &&
        /^[a-zA-Z0-9._:-]{8,160}$/.test(raw)
      ) {
        storage()?.setItem(
          key,
          JSON.stringify({ id: raw, revision, targetFingerprint: null })
        )
        return raw
      }
    }
  }
  const next = createKey()
  storage()?.setItem(
    key,
    JSON.stringify({
      id: next,
      revision,
      targetFingerprint: targetFingerprint ?? null,
    })
  )
  return next
}

export function clearHostedChannelOperation(operation: string): void {
  storage()?.removeItem(`${PREFIX}${operation}`)
}

export function clearHostedWhatsAppRecovery(): void {
  clearHostedChannelOperation("whatsapp.challenge")
  storage()?.removeItem(LEGACY_PHONE_KEY)
}

function reconcile(operation: string, revision: string, retain: boolean): void {
  const key = `${PREFIX}${operation}`
  const raw = storage()?.getItem(key)
  if (!raw) return
  let id: string | null
  let storedRevision: string | null = null
  try {
    const value = JSON.parse(raw) as StoredOperation
    id = value.id
    storedRevision = value.revision
  } catch {
    id = raw
  }
  if (!id || storedRevision === revision) return
  if (retain) {
    let targetFingerprint: string | null = null
    try {
      targetFingerprint = (JSON.parse(raw) as StoredOperation)
        .targetFingerprint
    } catch {
      // Legacy operation records did not include a target fingerprint.
    }
    storage()?.setItem(
      key,
      JSON.stringify({ id, revision, targetFingerprint })
    )
  } else storage()?.removeItem(key)
}

export function reconcileHostedChannelOperations(channels: {
  whatsapp: { state: string; revision: string }
  telegram: { state: string; revision: string }
}): void {
  storage()?.removeItem(LEGACY_PHONE_KEY)
  reconcile(
    "whatsapp.challenge",
    channels.whatsapp.revision,
    channels.whatsapp.state === "awaiting_code"
  )
  reconcile(
    "whatsapp.disconnect",
    channels.whatsapp.revision,
    channels.whatsapp.state === "off"
  )
  reconcile("whatsapp.test", channels.whatsapp.revision, false)
  reconcile(
    "telegram.connect",
    channels.telegram.revision,
    channels.telegram.state === "awaiting_code"
  )
  reconcile(
    "telegram.disconnect",
    channels.telegram.revision,
    channels.telegram.state === "off"
  )
  reconcile("telegram.test", channels.telegram.revision, false)
}
