import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CopyButtonProps = {
  value: string
  label?: string
  className?: string
} & Pick<React.ComponentProps<typeof Button>, "variant" | "size">

export function CopyButton({
  value,
  label,
  className,
  variant = "outline",
  size = "icon-sm",
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => {
      setCopied(false)
    }, 1500)
  }

  const Icon = copied ? CheckIcon : CopyIcon
  const showLabel = label !== undefined

  return (
    <Button
      type="button"
      variant={variant}
      size={showLabel ? "sm" : size}
      className={cn("shrink-0", className)}
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {showLabel ? (
        <>
          <Icon data-icon="inline-start" />
          {copied ? "Copied" : label}
        </>
      ) : (
        <Icon />
      )}
    </Button>
  )
}

export function CodeSnippet({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border bg-muted/50 p-3",
        className
      )}
    >
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground">
        {code}
      </pre>
      <CopyButton value={code} variant="ghost" />
    </div>
  )
}
