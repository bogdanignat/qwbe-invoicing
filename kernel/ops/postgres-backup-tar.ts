import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { createGunzip } from "node:zlib"

import { ArchiveRejected } from "./postgres-backup-paths.ts"

/**
 * The tar and gzip readers the restore path uses instead of `tar -t`.
 *
 * Why not the tool: in the shipped image `tar` is BusyBox 1.37.0, and the step-0
 * probe recorded what that means for a listing — a member whose name contains a
 * newline is printed across two lines, warnings are interleaved into the same
 * stream as the members, and on extraction a leading `../` or `/` is silently
 * stripped while a symlink member is created as given. A listing is therefore
 * not parseable and an extraction is not reviewable after the fact, so the
 * archive is read here, in bounded code, and only names this module accepted are
 * ever written.
 *
 * Nothing in here touches the filesystem beyond reading the input, and no
 * decision is taken from a member's own claim about itself except its size, which
 * is bounded twice (per member and in total).
 */

export interface ArchiveLimits {
  readonly maxMembers: number
  readonly maxMemberBytes: number
  readonly maxExpandedBytes: number
  readonly maxCompressedBytes: number
  readonly runtimeMillis: number
}

/**
 * Bounds, not guesses: the dump of a development database and a handful of PDFs
 * are orders of magnitude below these, and every one of them is an explicit
 * refusal rather than an out-of-memory or a filled disk. `maxExpandedBytes` is
 * the decompression-bomb bound; no ratio is computed, because the absolute cap
 * is the property that matters.
 */
export const defaultArchiveLimits: ArchiveLimits = {
  maxMembers: 4_096,
  maxMemberBytes: 512 * 1024 * 1024,
  maxExpandedBytes: 1024 * 1024 * 1024,
  maxCompressedBytes: 512 * 1024 * 1024,
  runtimeMillis: 120_000,
}

export const blockSize = 512

export interface TarHeader {
  readonly path: string
  readonly byteLength: number
  readonly directory: boolean
}

/**
 * An octal numeric field. GNU's base-256 extension (high bit set in the first
 * byte) is refused rather than decoded: it only appears for values no member of
 * this layout can reach, and accepting it would widen the parser for no gain.
 */
const octal = (block: Buffer, offset: number, length: number, field: string): number => {
  const raw = block.subarray(offset, offset + length)
  if (((raw[0] ?? 0) & 0x80) !== 0) throw new ArchiveRejected(`${field} uses the base-256 extension`)
  const text = raw.toString("latin1").replace(/\0[\s\S]*$/u, "").trim()
  if (text.length === 0) return 0
  if (!/^[0-7]+$/u.test(text)) throw new ArchiveRejected(`${field} is not octal`)
  return Number.parseInt(text, 8)
}

/**
 * The header checksum, with the checksum field read as spaces. Both the unsigned
 * and the historical signed sum are accepted, because writers disagree and
 * rejecting one would reject valid archives; a header that matches neither is
 * corrupt.
 */
const assertChecksum = (block: Buffer): void => {
  const stored = octal(block, 148, 8, "checksum")
  let unsigned = 0
  let signed = 0
  for (let index = 0; index < blockSize; index += 1) {
    const byte = block[index] ?? 0
    const blanked = index >= 148 && index < 156
    unsigned += blanked ? 32 : byte
    signed += blanked ? 32 : (byte > 127 ? byte - 256 : byte)
  }
  if (stored !== unsigned && stored !== signed) throw new ArchiveRejected("member header checksum is invalid")
}

const text = (block: Buffer, offset: number, length: number): string => {
  const raw = block.subarray(offset, offset + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end === -1 ? length : end).toString("utf8")
}

/**
 * Regular files and the layout's directories, and nothing else.
 *
 * Every other type flag is named in the refusal so a hostile archive is
 * diagnosable: hard link (`1`), symlink (`2`), character and block device (`3`,
 * `4`), FIFO (`6`), contiguous (`7`), the PAX extended and global headers (`x`,
 * `g`) and GNU's long-name and long-link records (`L`, `K`). PAX is refused
 * outright rather than handled: a pax header rewrites the name of the member
 * that follows it, which is exactly the indirection this parser exists to deny.
 */
const typeNames = new Map<string, string>([
  ["1", "hard link"], ["2", "symbolic link"], ["3", "character device"], ["4", "block device"],
  ["6", "FIFO"], ["7", "contiguous file"], ["x", "PAX extended header"], ["g", "PAX global header"],
  ["L", "GNU long name"], ["K", "GNU long link name"],
])

export const parseHeader = (block: Buffer): TarHeader => {
  if (block.subarray(257, 262).toString("latin1") !== "ustar") {
    throw new ArchiveRejected("member header is not ustar")
  }
  assertChecksum(block)
  const type = String.fromCharCode(block[156] ?? 0)
  if (type !== "0" && type !== "\0" && type !== "5") {
    throw new ArchiveRejected(`member type is not allowed: ${typeNames.get(type) ?? `flag ${JSON.stringify(type)}`}`)
  }
  if ((block[345] ?? 0) !== 0) throw new ArchiveRejected("member name prefix is not supported")
  if (block.subarray(157, 257).some((byte) => byte !== 0)) {
    throw new ArchiveRejected("member carries a link target")
  }
  const name = text(block, 0, 100)
  const byteLength = octal(block, 124, 12, "size")
  const directory = type === "5" || name.endsWith("/")
  if (directory && byteLength !== 0) throw new ArchiveRejected("directory member carries content")
  return { path: directory ? name.replace(/\/+$/u, "") : name, byteLength, directory }
}

/**
 * The input, decompressed, with both sides counted.
 *
 * The read stream is driven through a generator so the compressed bound is
 * enforced before gunzip ever sees the bytes, and its error is forwarded into
 * gunzip by hand: `pipe` does not propagate it, and a bound that only fails the
 * source would leave the consumer waiting on a stream that will never end.
 */
/**
 * A zlib failure, as opposed to a filesystem one.
 *
 * Only the first may be reported as an unacceptable archive (CLI exit 2). An
 * `EACCES`, `EIO` or `ENOENT` while reading the file is an internal failure (exit 1)
 * and must keep its own identity — the read-back a backup performs on the archive it
 * just wrote reads a file the operator never supplied, so calling a disc error
 * "your input is invalid" would be wrong twice over.
 */
const isZlibFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const code: unknown = (error as { readonly code?: unknown }).code
  if (typeof code === "string") return code.startsWith("Z_")
  return /unexpected end of file|incorrect header check|invalid (?:distance|stored block|code)/iu.test(error.message)
}

export const expandedBlocks = async function* (
  file: string,
  limits: ArchiveLimits,
): AsyncGenerator<Buffer> {
  let compressed = 0
  const bytes = createReadStream(file, { highWaterMark: 1 << 16 })
  const source = Readable.from((async function* () {
    for await (const chunk of bytes) {
      compressed += (chunk as Buffer).length
      if (compressed > limits.maxCompressedBytes) throw new ArchiveRejected("compressed input exceeds the bound")
      yield chunk as Buffer
    }
  })())
  const gunzip = createGunzip()
  source.on("error", (error: Error) => { gunzip.destroy(error) })
  source.pipe(gunzip)
  // Every exit closes every descriptor. `pipe` does not propagate a teardown
  // backwards, so a consumer that stops early — any `ArchiveRejected` from the
  // state machine — would otherwise leave the file open: harmless in a one-shot
  // CLI, an EMFILE in a process that validates archives repeatedly.
  try {
    let pending: Buffer = Buffer.alloc(0)
    let expanded = 0
    for await (const chunk of gunzip) {
      expanded += (chunk as Buffer).length
      if (expanded > limits.maxExpandedBytes) throw new ArchiveRejected("expanded archive exceeds the bound")
      pending = pending.length === 0 ? (chunk as Buffer) : Buffer.concat([pending, chunk as Buffer])
      let offset = 0
      while (pending.length - offset >= blockSize) {
        yield pending.subarray(offset, offset + blockSize)
        offset += blockSize
      }
      pending = pending.subarray(offset)
    }
    if (pending.length > 0) throw new ArchiveRejected("archive is truncated mid-block")
  } catch (error) {
    // A truncated or corrupt gzip stream is unacceptable input, not an internal
    // defect: zlib's own `Z_BUF_ERROR` / "unexpected end of file" would otherwise
    // reach the CLI as exit 1 instead of the exit 2 an archive refusal carries. A
    // filesystem error is the opposite case and is rethrown untouched.
    if (error instanceof ArchiveRejected) throw error
    if (!isZlibFailure(error)) throw error
    throw new ArchiveRejected(
      `archive is not a readable gzip stream: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    gunzip.destroy()
    source.destroy()
    bytes.destroy()
  }
}

export const isZeroBlock = (block: Buffer): boolean => !block.some((byte) => byte !== 0)
