import { Button } from "@/components/ui/button"

// Transplanted from zenod-ai/cloud services/console/src/App.tsx @ 6bdb318.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.42l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.87A6 6 0 0 1 6.08 12c0-.65.11-1.28.31-1.87V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 6c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.62C7.18 7.76 9.39 6 12 6Z"
      />
    </svg>
  )
}

export function HostedLogin({
  methods = ["github", "google"],
}: {
  methods?: Array<"github" | "google">
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-sm overflow-hidden border border-border bg-card text-center">
        <img
          src="/plates/zenod-plate-charcoal.jpg"
          alt="Zenod, the Librarian, engraved in silver and gold"
          className="aspect-square w-full border-b border-border bg-black object-cover"
        />
        <div className="p-8">
          <h1 className="text-3xl font-semibold">Zenod</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The librarian that keeps your thoughts
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {methods.includes("google") ? (
              <Button
                asChild
                size="lg"
                variant="outline"
                className="w-full rounded-none"
              >
                <a href="/auth/google/start">
                  <GoogleMark className="size-5" />
                  Continue with Google
                </a>
              </Button>
            ) : null}
            {methods.includes("github") ? (
              <Button
                asChild
                size="lg"
                className="w-full rounded-none bg-[#24292f] text-white hover:bg-[#1b1f24] hover:text-white"
              >
                <a href="/auth/github/start">
                  <GithubMark className="size-5" />
                  Continue with GitHub
                </a>
              </Button>
            ) : null}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Sign-in uses only your basic profile and email. If you choose Google
            Drive for your vault, Zenod asks for that separate permission after
            checkout. GitHub repository access is also connected separately.
          </p>
          <a
            href="https://zenod.dev"
            className="mt-6 inline-block text-xs text-muted-foreground underline hover:text-foreground"
          >
            zenod.dev
          </a>
        </div>
      </section>
    </main>
  )
}
