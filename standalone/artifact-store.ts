import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

import { Effect } from "effect"

import {
  DocumentPersistenceFailure,
  type PdfArtifact,
  type PdfObjectStore,
  type StoredPdf,
} from "../cube/invoicing/documents/index.ts"

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
const failure = (operation: string) => new DocumentPersistenceFailure({ operation })

const objectKey = (sha256: string): string => `sha256/${sha256.slice(0, 2)}/${sha256}.pdf`

const verified = (key: string, bytes: Uint8Array): StoredPdf => {
  const sha256 = digest(bytes)
  if (key !== objectKey(sha256)) throw new Error("artifact object key does not match content")
  return { objectKey: key, sha256, byteLength: bytes.length }
}

const persist = async (root: string, bytes: Uint8Array): Promise<StoredPdf> => {
  const sha256 = digest(bytes)
  const key = objectKey(sha256)
  const target = join(root, key)
  const directory = dirname(target)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    const existing = new Uint8Array(await readFile(target))
    try {
      return verified(key, existing)
    } catch {
      // Corrupt content-addressed object is replaced below from deterministic bytes.
    }
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error
  }

  const temporary = join(directory, `.${sha256}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    const directoryHandle = await open(directory, "r")
    try { await directoryHandle.sync() } finally { await directoryHandle.close() }
  } finally {
    await rm(temporary, { force: true })
  }
  return verified(key, new Uint8Array(await readFile(target)))
}

const safePath = (root: string, artifact: PdfArtifact): string => {
  if (!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}[.]pdf$/.test(artifact.objectKey)) {
    throw new Error("invalid artifact object key")
  }
  return join(root, artifact.objectKey)
}

export const createPdfObjectStore = (dataDirectory: string): PdfObjectStore => {
  const root = join(dataDirectory, "artifacts")
  return {
    putPdf: (bytes) => Effect.tryPromise({
      try: () => persist(root, bytes),
      catch: () => failure("persist pdf object"),
    }),
    readPdf: (artifact) => Effect.tryPromise({
      try: async () => {
        const bytes = new Uint8Array(await readFile(safePath(root, artifact)))
        const result = verified(artifact.objectKey, bytes)
        if (result.sha256 !== artifact.sha256 || result.byteLength !== artifact.byteLength) {
          throw new Error("artifact integrity mismatch")
        }
        return bytes
      },
      catch: () => failure("read pdf object"),
    }),
  }
}
