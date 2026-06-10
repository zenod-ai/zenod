import * as React from "react"
import { LogOutIcon } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type SettingsValues } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConnectionsTab } from "@/views/settings/ConnectionsTab"
import { KeysTab } from "@/views/settings/KeysTab"
import { VaultTab } from "@/views/settings/VaultTab"

export function Settings({
  initialSettings,
  initialTab,
  onLoggedOut,
}: {
  initialSettings: SettingsValues
  initialTab?: "vault" | "keys" | "connections"
  onLoggedOut: () => void
}) {
  const [loggingOut, setLoggingOut] = React.useState(false)

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
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold tracking-tight">Zenod</h1>
          <p className="text-sm text-muted-foreground">
            Self-hosted memory agent
          </p>
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

      <Tabs defaultValue={initialTab ?? "vault"}>
        <TabsList>
          <TabsTrigger value="vault">Vault</TabsTrigger>
          <TabsTrigger value="keys">Keys &amp; models</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>
        <TabsContent value="vault" className="mt-4">
          <VaultTab />
        </TabsContent>
        <TabsContent value="keys" className="mt-4">
          <KeysTab initial={initialSettings} />
        </TabsContent>
        <TabsContent value="connections" className="mt-4">
          <ConnectionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
