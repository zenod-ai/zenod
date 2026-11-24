// E7-S32: reading an Obsidian vault in the browser, from a .zip or a picked folder. Uses the same sample vault
// as the server's end-to-end test (packages/server/test/fixtures/obsidian-sample).
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32, deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"

import { entriesFromFolder, IMPORT_LIMITS, notesFromEntries, notesFromZip, VaultImportError, type VaultEntry } from "./obsidian-import"

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/server/test/fixtures/obsidian-sample")

async function sampleFiles(): Promise<{ path: string; data: Buffer }[]> {
  const out: { path: string; data: Buffer }[] = []
  async function walk(at: string) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) await walk(full)
      else out.push({ path: relative(SAMPLE, full), data: await readFile(full) })
    }
  }
  await walk(SAMPLE)
  return out
}

/** A minimal .zip writer (what macOS Compress and Windows Send to › Compressed folder make). */
function zip(files: { path: string; data: Buffer }[], method: 0 | 8 = 8): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8")
    const body = method === 8 ? deflateRawSync(file.data) : file.data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc32(file.data), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc32(file.data), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const asFile = (buffer: Buffer, name: string) => new File([new Uint8Array(buffer)], name, { type: "application/zip" })

describe("reading an Obsidian vault (E7-S32)", () => {
  it("reads a zipped vault folder: its notes unchanged, the folder's name, .obsidian and pictures left out", async () => {
    const files = await sampleFiles()
    const zipped = zip(files.map((file) => ({ ...file, path: `My Garden/${file.path}` })))
    const notes = await notesFromZip(asFile(zipped, "export.zip"))
    expect(notes.vaultName).toBe("My Garden")
    expect(notes.files.map((file) => file.name)).toEqual(["Daily/2026-11-20.md", "Projects/Garden plan.md", "Welcome.md"])
    expect(notes.skippedOther).toBe(1)
    const welcome = notes.files.find((file) => file.name === "Welcome.md")!
    expect(welcome.content).toBe((await readFile(join(SAMPLE, "Welcome.md"), "utf8")))
    expect(welcome.content).toContain("tags: [start, garden]")
    expect(welcome.content).toContain("[[Garden plan]]")
  })

  it("reads a stored (uncompressed) zip with notes at its root, named after the file", async () => {
    const notes = await notesFromZip(asFile(zip(await sampleFiles(), 0), "Second brain.zip"))
    expect(notes.vaultName).toBe("Second brain")
    expect(notes.files).toHaveLength(3)
  })

  it("reads a picked folder the way the browser hands it over", async () => {
    const picked = (await sampleFiles()).map((file) => {
      const f = new File([new Uint8Array(file.data)], file.path.split("/").at(-1)!)
      Object.defineProperty(f, "webkitRelativePath", { value: `obsidian-sample/${file.path}` })
      return f
    })
    const notes = await notesFromEntries(entriesFromFolder(picked), "Obsidian")
    expect(notes.vaultName).toBe("obsidian-sample")
    expect(notes.files.map((file) => file.name)).toEqual(["Daily/2026-11-20.md", "Projects/Garden plan.md", "Welcome.md"])
  })

  it("leaves out notes over the per-note limit and refuses a vault past the limits in plain words", async () => {
    const entry = (path: string, size: number, content = "x"): VaultEntry => ({ path, size, read: async () => content })
    const some = await notesFromEntries([entry("V/a.md", 10), entry("V/huge.md", IMPORT_LIMITS.maxFileBytes + 1)], "V")
    expect(some.files.map((f) => f.name)).toEqual(["a.md"])
    expect(some.skippedTooBig).toBe(1)
    await expect(notesFromEntries([entry("V/a.png", 10)], "V")).rejects.toThrow(VaultImportError)
    const many = Array.from({ length: IMPORT_LIMITS.maxFiles + 1 }, (_, i) => entry(`V/n${i}.md`, 1))
    await expect(notesFromEntries(many, "V")).rejects.toThrow(/up to 2000/)
    await expect(notesFromZip(asFile(Buffer.from("not a zip"), "x.zip"))).rejects.toThrow(/not a .zip/)
  })
})
