const PREFIX = "zenod.hosted-channel.operation."

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

export function hostedChannelOperationKey(
  operation: string,
  reset = false
): string {
  const key = `${PREFIX}${operation}`
  const current = reset ? null : storage()?.getItem(key)
  if (current) return current
  const next = createKey()
  storage()?.setItem(key, next)
  return next
}

export function clearHostedChannelOperation(operation: string): void {
  storage()?.removeItem(`${PREFIX}${operation}`)
}

export function rememberHostedWhatsAppSender(sender: string): void {
  storage()?.setItem(`${PREFIX}whatsapp.sender`, sender)
}

export function rememberedHostedWhatsAppSender(): string {
  return storage()?.getItem(`${PREFIX}whatsapp.sender`) ?? ""
}

export function clearHostedWhatsAppRecovery(): void {
  clearHostedChannelOperation("whatsapp.challenge")
  storage()?.removeItem(`${PREFIX}whatsapp.sender`)
}
