import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { useOptionalTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const OPTIONS = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const

/** Light / Dark / System segmented control; the choice persists via ThemeProvider. */
export function ThemeToggle() {
  const ctx = useOptionalTheme()
  if (!ctx) return null
  const { theme, setTheme } = ctx

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center rounded-lg border border-border p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              active && "bg-muted text-foreground"
            )}
          >
            <Icon className="size-3.5" />
          </button>
        )
      })}
    </div>
  )
}
