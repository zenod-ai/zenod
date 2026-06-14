import * as React from "react"
import { BrainIcon, LogOutIcon } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type SettingsValues } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChatTab } from "@/views/ChatTab"
import { ConnectionsTab } from "@/views/settings/ConnectionsTab"
import { TranscriptionTab } from "@/views/settings/TranscriptionTab"
import { KeysTab } from "@/views/settings/KeysTab"
import { VaultTab } from "@/views/settings/VaultTab"

export function Settings({
  initialSettings,
  initialTab,
  onLoggedOut,
}: {
  initialSettings: SettingsValues
  initialTab?: "chat" | "vault" | "keys" | "transcription" | "connections"
  onLoggedOut: () => void
}) {
  const [loggingOut, setLoggingOut] = React.useState(false)
  // Source of truth for settings: lives here so it survives tab switches (Radix
  // unmounts inactive TabsContent). KeysTab re-seeds from this on remount.
  const [settings, setSettings] = React.useState(initialSettings)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await api("/api/auth/logout", { method: "POST" })
      onLoggedOut()
    } catch (err) {
      toast.error("Could not log out", { description: errorMessage(err) })
      setLoggingOut(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <BrainIcon className="size-4.5" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold tracking-tight">Zenod</h1>
            <p className="text-sm text-muted-foreground">
              Self-hosted memory agent
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={loggingOut}
          onClick={handleLogout}
        >
          {loggingOut ? <Spinner /> : <LogOutIcon data-icon="inline-start" />}
          Log out
        </Button>
      </header>

      <Tabs defaultValue={initialTab ?? "chat"}>
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="vault">Vault</TabsTrigger>
          <TabsTrigger value="keys">Keys &amp; models</TabsTrigger>
          <TabsTrigger value="transcription">Transcription</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-4">
          <ChatTab />
        </TabsContent>
        <TabsContent value="vault" className="mt-4">
          <VaultTab />
        </TabsContent>
        <TabsContent value="keys" className="mt-4">
          <KeysTab initial={settings} onSaved={setSettings} />
        </TabsContent>
        <TabsContent value="transcription" className="mt-4">
          <TranscriptionTab />
        </TabsContent>
        <TabsContent value="connections" className="mt-4">
          <ConnectionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
