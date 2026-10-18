import { createReadStream, createWriteStream } from "node:fs"
import { open, stat } from "node:fs/promises"
import { dirname } from "node:path"
import { pipeline } from "node:stream/promises"
import type { Writable } from "node:stream"
import { createGzip } from "node:zlib"

import { blockSize } from "./postgres-backup-tar.ts"
import { safeMemberPath } from "./postgres-backup-paths.ts"

/**
 * The archive writer, so that creating a backup uses no external archiver either.
 *
 * `tar -czf` would work — the step-0 probe confirmed BusyBox round-trips the
 * layout — but writing the headers here makes the artifact's bytes a function of
 * its content alone: owner, group, mode and mtime are fixed, so two backups of
 * the same database and the same artifacts differ only where their data differs.
 * It also leaves one tar implementation in the repository instead of two
 * disagreeing ones, and the reader in `postgres-backup-tar.ts` is strict enough
 * that any drift between them fails loudly on the next restore.
 *
 * Only regular files are emitted. No directory member is written at all: the
 * reader creates parents itself, and a layout with no directory entries has no
 * directory entry to attack.
 */

const pad = (text: string, length: number): Buffer => {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length >= length) throw new Error(`archive field does not fit: ${text}`)
  return Buffer.concat([bytes, Buffer.alloc(length - bytes.length)])
}

/** An octal field, NUL-terminated, the shape `parseHeader` reads back. */
const octal = (value: number, length: number): Buffer =>
  pad(value.toString(8).padStart(length - 1, "0"), length)

const header = (path: string, byteLength: number): Buffer => {
  const block = Buffer.alloc(blockSize)
  pad(path, 100).copy(block, 0)
  octal(0o600, 8).copy(block, 100)
  octal(0, 8).copy(block, 108)
  octal(0, 8).copy(block, 116)
  octal(byteLength, 12).copy(block, 124)
  octal(0, 12).copy(block, 136)
  block.fill(32, 148, 156)
  block.write("0", 156, "latin1")
  Buffer.from("ustar\0", "latin1").copy(block, 257)
  Buffer.from("00", "latin1").copy(block, 263)
  let sum = 0
  for (const byte of block) sum += byte
  octal(sum, 8).copy(block, 148)
  return block
}

const push = async (stream: Writable, chunk: Buffer): Promise<void> =>
  new Promise<void>((settle, fail) => {
    stream.write(chunk, (error) => { if (error) fail(error); else settle() })
  })

/**
 * `wx` on the output: a backup never overwrites an artifact that is already there,
 * and never follows a symlink planted at the destination.
 *
 * Both the file and its parent directory are fsynced before this returns. Without
 * that, a crash or a power loss right after `close` can leave a truncated file that
 * every report already called a successful backup.
 */
export const writeArchive = async (
  staging: string,
  members: ReadonlyArray<string>,
  output: string,
): Promise<void> => {
  const gzip = createGzip({ level: 9 })
  const closed = pipeline(gzip, createWriteStream(output, { flags: "wx", mode: 0o600 }))
  try {
    for (const member of members) {
      const path = safeMemberPath(staging, member)
      const { size } = await stat(path)
      await push(gzip, header(member, size))
      let written = 0
      for await (const chunk of createReadStream(path, { highWaterMark: 1 << 16 })) {
        written += (chunk as Buffer).length
        await push(gzip, chunk as Buffer)
      }
      if (written !== size) throw new Error(`archive member changed size while it was written: ${member}`)
      const remainder = written % blockSize
      if (remainder !== 0) await push(gzip, Buffer.alloc(blockSize - remainder))
    }
    await push(gzip, Buffer.alloc(blockSize * 2))
    gzip.end()
    await closed
  } catch (error) {
    // The destination is torn down on the failure path too, and the original error
    // is the one reported: a half-written archive must not look like a broken pipe.
    gzip.destroy()
    await closed.catch(() => undefined)
    throw error
  }
  // The file is reopened to be synced rather than kept open across the pipeline:
  // a stream told not to close its handle never emits `close`, and `pipeline` then
  // waits for it forever. Reopening is equivalent — the bytes are in the page
  // cache, and `fsync` flushes them from there.
  const file = await open(output, "r+")
  try { await file.sync() } finally { await file.close() }
  // The parent directory too: an unsynced directory entry can lose the name of a
  // file whose contents already reached the disk.
  const parent = await open(dirname(output), "r")
  try { await parent.sync() } finally { await parent.close() }
}
