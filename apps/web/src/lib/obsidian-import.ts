// E7-S32: bring an existing Obsidian vault into Zenod in one step. The browser reads the vault (a picked
// folder or a .zip of it), keeps only the Markdown notes, and sends them to POST /api/vault/import, which
// writes them unchanged under Imported/<vault>/. Nothing is uploaded until the tester presses Import.

/** The same numbers the server enforces (zenod NOTES_IMPORT_LIMITS). */
export const IMPORT_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  /** A .zip bigger than this is refused before it is read (pictures and PDFs make most of a vault's size). */
  maxZipBytes: 200 * 1024 * 1024,
})

export type VaultEntry = { path: string; size: number; read: () => Promise<string> }

export type VaultNotes = {
  vaultName: string
  files: { name: string; content: string }[]
  /** Pictures, PDFs and other files that are not notes: left out. */
  skippedOther: number
  /** Notes over the per-note limit: left out. */
  skippedTooBig: number
  totalBytes: number
}

export class VaultImportError extends Error {}

const SKIP_PARTS = new Set(["__MACOSX", "node_modules"])

function cleanPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "")
}

/** The folder every entry sits in, when they all share one (a zipped folder or a picked folder). */
function commonTop(paths: string[]): string | null {
  const tops = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")))
  if (tops.size !== 1) return null
  const [top] = [...tops]
  return top ? top : null
}

/** Keep the vault's notes (.md, not in hidden folders like .obsidian or .trash), inside the limits. */
export async function notesFromEntries(entries: VaultEntry[], fallbackName: string): Promise<VaultNotes> {
  const usable = entries
    .map((entry) => ({ ...entry, path: cleanPath(entry.path) }))
    .filter((entry) => entry.path && !entry.path.endsWith("/"))
    .filter((entry) => !entry.path.split("/").some((part) => SKIP_PARTS.has(part)))
  const top = commonTop(usable.map((entry) => entry.path))
  const vaultName = (top ?? fallbackName).trim() || "Obsidian"
  let skippedOther = 0
  let skippedTooBig = 0
  let totalBytes = 0
  const files: VaultNotes["files"] = []
  for (const entry of usable) {
    const name = top ? entry.path.slice(top.length + 1) : entry.path
    const parts = name.split("/")
    if (parts.some((part) => part.startsWith("."))) continue
    if (!name.toLowerCase().endsWith(".md")) {
      skippedOther++
      continue
    }
    if (entry.size > IMPORT_LIMITS.maxFileBytes) {
      skippedTooBig++
      continue
    }
    const content = await entry.read()
    totalBytes += new TextEncoder().encode(content).length
    files.push({ name: name.replace(/\.MD$/i, ".md"), content })
  }
  if (files.length === 0) throw new VaultImportError("No Markdown notes were found there. Pick the folder that holds your vault’s .md files.")
  if (files.length > IMPORT_LIMITS.maxFiles)
    throw new VaultImportError(`That vault has ${files.length} notes. One import takes up to ${IMPORT_LIMITS.maxFiles}: import one of its folders at a time.`)
  if (totalBytes > IMPORT_LIMITS.maxTotalBytes)
    throw new VaultImportError(`Those notes come to ${Math.ceil(totalBytes / 1024 / 1024)} MB. One import takes up to ${IMPORT_LIMITS.maxTotalBytes / 1024 / 1024} MB: import one of its folders at a time.`)
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { vaultName, files, skippedOther, skippedTooBig, totalBytes }
}

/** A picked folder (`<input webkitdirectory>`): each File carries its path in webkitRelativePath. */
export function entriesFromFolder(list: ArrayLike<File>): VaultEntry[] {
  return Array.from(list).map((file) => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    size: file.size,
    read: () => file.text(),
  }))
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The files in a .zip (stored or deflated, as every OS and Obsidian's export make them). */
export function entriesFromZip(buffer: ArrayBuffer): VaultEntry[] {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new VaultImportError("That file is not a .zip Zenod can open.")
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || offset === 0xffffffff) throw new VaultImportError("That .zip is too large to open here. Pick the vault folder instead.")
  const decoder = new TextDecoder()
  const entries: VaultEntry[] = []
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new VaultImportError("That .zip looks damaged.")
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
    if (path.endsWith("/")) continue
    entries.push({
      path,
      size,
      read: async () => {
        if (flags & 1) throw new VaultImportError("That .zip has a password. Zip the vault again without one.")
        if (view.getUint32(local, true) !== 0x04034b50) throw new VaultImportError("That .zip looks damaged.")
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
        const raw = bytes.subarray(start, start + compressed)
        if (method === 0) return decoder.decode(raw)
        if (method === 8) return decoder.decode(await inflateRaw(raw))
        throw new VaultImportError("That .zip uses a kind of compression Zenod cannot read. Zip it again with your computer’s own Compress.")
      },
    })
  }
  return entries
}

export async function notesFromZip(file: File): Promise<VaultNotes> {
  if (file.size > IMPORT_LIMITS.maxZipBytes)
    throw new VaultImportError(`That .zip is ${Math.ceil(file.size / 1024 / 1024)} MB. Pick the vault folder instead, or zip it without pictures.`)
  return notesFromEntries(entriesFromZip(await file.arrayBuffer()), file.name.replace(/\.zip$/i, ""))
}
