import * as React from "react"
import { BrainIcon, LogInIcon } from "lucide-react"

import { api, errorMessage, isUnauthorized } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await api("/api/auth/login", { method: "POST", body: { password } })
      onSuccess()
    } catch (err) {
      setError(isUnauthorized(err) ? "Incorrect password." : errorMessage(err))
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <div className="mb-1 flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <BrainIcon className="size-4.5" />
            </div>
            <CardTitle>Zenod</CardTitle>
            <CardDescription>
              Enter your admin password to manage this server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={error !== null || undefined}>
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  aria-invalid={error !== null || undefined}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError(null)
                  }}
                />
                {error !== null && <FieldError>{error}</FieldError>}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={pending || password.length === 0}
            >
              {pending ? <Spinner /> : <LogInIcon data-icon="inline-start" />}
              Sign in
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
