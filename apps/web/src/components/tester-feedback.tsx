import * as React from "react"
import { MicIcon } from "lucide-react"

/**
 * EPIC-7 E7-S9: a tester's own voice feedback link (the team's voice-feedback page: talk for a minute, the audio is
 * transcribed and dropped). One quiet entry in the header, testers only: the server answers `url: null` to everyone
 * else, and nothing shows.
 */
export function useTesterFeedbackLink(): string | null {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    let live = true
    void fetch("/api/console/feedback-link")
      .then((response) => (response.ok ? (response.json() as Promise<{ url?: unknown }>) : null))
      .then((body) => {
        if (live && typeof body?.url === "string" && body.url.startsWith("https://")) setUrl(body.url)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return url
}

export function TesterFeedbackEntry() {
  const url = useTesterFeedbackLink()
  if (!url) return null
  return (
    <a
      className="zl-feedback"
      data-testid="tester-feedback"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Leave us a voice note: nobody listens to the audio, it becomes text for our team"
    >
      <MicIcon aria-hidden="true" />
      Tell us what you think
    </a>
  )
}
