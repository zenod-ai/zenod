import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  plainWikilinks,
  readMemoryNote,
  vaultLabel,
  type MemoryNote,
} from "@/lib/memory-chat"

// EPIC-12 E12-S1: a memory opened from a chat link (`#memory?path=…`), read from the
// signed-in customer's own vault.

type State =
  | { kind: "loading" }
  | { kind: "ready"; note: MemoryNote }
  | { kind: "error"; message: string }

const stripFrontmatter = (body: string) =>
  body.replace(/^---\n[\s\S]*?\n---\n?/, "")

export function MemoryNoteViewer({
  path,
  onClose,
}: {
  path: string
  onClose: () => void
}) {
  const [state, setState] = React.useState<State>({ kind: "loading" })

  React.useEffect(() => {
    // Keyed by path in its parent, so a new path starts a fresh "loading" state.
    let live = true
    readMemoryNote(path)
      .then((note) => live && setState({ kind: "ready", note }))
      .catch(
        (error: unknown) =>
          live &&
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Not found.",
          })
      )
    return () => {
      live = false
    }
  }, [path])

  const title = path.split("#")[0]!.split("/").pop()!.replace(/\.md$/i, "")
  return (
    <article className="zp zp-note" aria-label={`Memory ${title}`}>
      <div className="zp-notehead">
        <a
          href="#chat"
          className="zp-back"
          onClick={(event) => {
            event.preventDefault()
            onClose()
          }}
        >
          ← Back to chat
        </a>
        <h2>{title}</h2>
        <p className="zp-path">{path.split("#")[0]}</p>
      </div>
      {state.kind === "loading" ? <p className="zp-hint">Opening…</p> : null}
      {state.kind === "error" ? (
        <p className="zp-hint zp-warn" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "ready" ? (
        <>
          <div className="zp-notebody">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {plainWikilinks(stripFrontmatter(state.note.body))}
            </ReactMarkdown>
          </div>
          {state.note.url ? (
            <p className="zp-hint">
              <a href={state.note.url} target="_blank" rel="noreferrer">
                Open in {vaultLabel(state.note.provider)}
              </a>
            </p>
          ) : null}
        </>
      ) : null}
    </article>
  )
}
