import * as React from "react"

import { api, ApiError } from "@/lib/api"
import {
  entriesFromFolder,
  notesFromEntries,
  notesFromZip,
  VaultImportError,
  type VaultNotes,
} from "@/lib/obsidian-import"
import "./obsidian-import.css"

// E7-S32: a tester who already keeps an Obsidian vault brings it in, in one step, from Memory › At a glance
// (and the quick start points here). The notes arrive unchanged, links and all, under Imported/<vault>/.

export const OBSIDIAN_IMPORT_ID = "obsidian-import"

type ImportResult = { ok: true; folder: string; written: number; unchanged: number; headSha: string | null }

type State =
  | { step: "pick" }
  | { step: "reading" }
  | { step: "ready"; notes: VaultNotes }
  | { step: "importing"; notes: VaultNotes }
  | { step: "done"; notes: VaultNotes; result: ImportResult }
  | { step: "error"; message: string }

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Scroll the import card into view (used by the quick start). */
export function showObsidianImport() {
  setTimeout(() => document.getElementById(OBSIDIAN_IMPORT_ID)?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 60)
}

export function ObsidianImportCard({ onOpenTree }: { onOpenTree?: () => void }) {
  const [state, setState] = React.useState<State>({ step: "pick" })
  const folderInput = React.useRef<HTMLInputElement>(null)
  const zipInput = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    // React does not pass webkitdirectory through as a known prop.
    folderInput.current?.setAttribute("webkitdirectory", "")
    folderInput.current?.setAttribute("directory", "")
  }, [])

  const read = async (load: () => Promise<VaultNotes>) => {
    setState({ step: "reading" })
    try {
      setState({ step: "ready", notes: await load() })
    } catch (error) {
      setState({ step: "error", message: error instanceof VaultImportError ? error.message : "Zenod could not read that. Try the vault folder, or a .zip of it." })
    }
  }

  const onFolder = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    void read(() => notesFromEntries(entriesFromFolder(files), "Obsidian"))
    event.target.value = ""
  }

  const onZip = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void read(() => notesFromZip(file))
    event.target.value = ""
  }

  const startImport = async (notes: VaultNotes) => {
    setState({ step: "importing", notes })
    try {
      const result = await api<ImportResult>("/api/vault/import", {
        method: "POST",
        body: { vaultName: notes.vaultName, files: notes.files },
      })
      setState({ step: "done", notes, result })
    } catch (error) {
      setState({ step: "error", message: error instanceof ApiError ? error.message : "The import did not reach Zenod. Check your connection and try again." })
    }
  }

  return (
    <section className="zp zo" id={OBSIDIAN_IMPORT_ID} aria-labelledby="zo-title" data-testid="obsidian-import">
      <div className="zo-head">
        <h2 id="zo-title">Already keep notes in Obsidian?</h2>
        <p className="zo-lede">
          Bring your whole vault into Zenod in one step. Your notes arrive as they are, with their links and
          properties, and Zenod can find them from day one. Importing uses no AI credit.
        </p>
      </div>

      <input ref={folderInput} type="file" multiple hidden onChange={onFolder} data-testid="obsidian-import-folder" />
      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={onZip} data-testid="obsidian-import-zip" />

      {state.step === "pick" || state.step === "error" ? (
        <>
          <div className="zo-row">
            <button type="button" className="zo-btn" onClick={() => folderInput.current?.click()}>
              Choose your vault folder
            </button>
            <button type="button" className="zo-btn ghost" onClick={() => zipInput.current?.click()}>
              Or a .zip of it
            </button>
          </div>
          <p className="zo-small">
            Nothing is sent until you press Import. Up to 2,000 notes and 20 MB at a time. Pictures, PDFs and
            Obsidian’s own settings stay on your computer.
          </p>
          {state.step === "error" ? (
            <p className="zo-error" role="alert">
              {state.message}
            </p>
          ) : null}
        </>
      ) : state.step === "reading" ? (
        <p className="zo-small" aria-live="polite">Reading your vault…</p>
      ) : state.step === "ready" || state.step === "importing" ? (
        <div className="zo-ready">
          <dl className="zo-facts">
            <div><dt>Vault</dt><dd data-testid="obsidian-import-name">{state.notes.vaultName}</dd></div>
            <div><dt>Notes</dt><dd data-testid="obsidian-import-count">{state.notes.files.length}</dd></div>
            <div><dt>Size</dt><dd>{mb(state.notes.totalBytes)}</dd></div>
          </dl>
          <p className="zo-small">
            They go into <b>Imported/{state.notes.vaultName}</b> in your memory.
            {state.notes.skippedOther > 0 ? ` ${plural(state.notes.skippedOther, "picture or other file", "pictures and other files")} ${state.notes.skippedOther === 1 ? "stays" : "stay"} out.` : ""}
            {state.notes.skippedTooBig > 0 ? ` ${plural(state.notes.skippedTooBig, "note")} over 512 KB ${state.notes.skippedTooBig === 1 ? "stays" : "stay"} out.` : ""}
          </p>
          <div className="zo-row">
            <button type="button" className="zo-btn" disabled={state.step === "importing"} onClick={() => void startImport(state.notes)}>
              {state.step === "importing" ? "Importing…" : `Import ${plural(state.notes.files.length, "note")}`}
            </button>
            <button type="button" className="zo-btn ghost" disabled={state.step === "importing"} onClick={() => setState({ step: "pick" })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="zo-done" role="status" data-testid="obsidian-import-done">
          <p className="zo-donehead">
            ✓ {plural(state.result.written + state.result.unchanged, "note")} from {state.notes.vaultName} {state.result.written + state.result.unchanged === 1 ? "is" : "are"} in your memory.
          </p>
          <p className="zo-small">
            {state.result.unchanged > 0 && state.result.written > 0
              ? `${plural(state.result.written, "note")} new or changed, ${state.result.unchanged} already there. `
              : state.result.written === 0
                ? "They were already there, unchanged. "
                : ""}
            Ask about them in Chat, or from Claude and WhatsApp. They live in <b>{state.result.folder.replace(/\/$/, "")}</b>.
          </p>
          <div className="zo-row">
            {onOpenTree ? (
              <button type="button" className="zo-btn" onClick={onOpenTree}>
                See them in your memory
              </button>
            ) : null}
            <button type="button" className="zo-btn ghost" onClick={() => setState({ step: "pick" })}>
              Import another
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
