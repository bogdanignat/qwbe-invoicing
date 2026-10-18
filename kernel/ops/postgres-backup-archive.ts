import { createHash } from "node:crypto"
import { mkdir, open } from "node:fs/promises"
import { dirname } from "node:path"

import { ArchiveRejected, assertAllowedMember, safeMemberPath } from "./postgres-backup-paths.ts"
import {
  type ArchiveLimits,
  blockSize,
  defaultArchiveLimits,
  expandedBlocks,
  isZeroBlock,
  parseHeader,
} from "./postgres-backup-tar.ts"

/**
 * Reading a backup archive: once to decide, once to extract.
 *
 * `inspectArchive` is the gate. It walks the whole stream — every header, every
 * byte of content, the end-of-archive marker and whatever follows it — and
 * writes nothing. `extractArchive` walks it again and writes, and it exists only
 * to be called after the gate returned. Two passes over a bounded gzip stream
 * cost little, and they buy the property the step is judged on: no byte of a
 * rejected archive ever reached the filesystem, because the only code that writes
 * had not started yet.
 *
 * The state machine is deliberately strict about shape rather than tolerant:
 * a single stray zero block, a short final member, data past the marker or a
 * second member with a name already seen are all refusals. The archives this
 * reads are written by `postgres-backup-create.ts`, so tolerance would only ever
 * accept something that is not one.
 */

export interface ArchiveMember {
  readonly path: string
  readonly byteLength: number
}

interface ArchiveSink {
  readonly begin: (member: ArchiveMember) => Promise<void>
  readonly data: (chunk: Buffer) => Promise<void>
  readonly end: () => Promise<void>
}

const countingSink: ArchiveSink = {
  begin: () => Promise.resolve(),
  data: () => Promise.resolve(),
  end: () => Promise.resolve(),
}

/**
 * `wx` is the whole TOCTOU answer for a member: `O_CREAT | O_EXCL | O_WRONLY`
 * never follows a symlink and never truncates something that is already there, so
 * a staging directory salted between the two passes cannot be written through.
 */
const extractionSink = (root: string): ArchiveSink => {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  return {
    begin: async (member) => {
      const target = safeMemberPath(root, member.path)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      handle = await open(target, "wx", 0o600)
    },
    data: async (chunk) => { await handle?.write(chunk) },
    end: async () => {
      const current = handle
      handle = undefined
      await current?.close()
    },
  }
}

const readArchive = async (
  file: string,
  sink: ArchiveSink,
  limits: ArchiveLimits,
): Promise<ReadonlyArray<ArchiveMember>> => {
  const deadline = Date.now() + limits.runtimeMillis
  const members: Array<ArchiveMember> = []
  const seen = new Set<string>()
  let entries = 0
  let zeroBlocks = 0
  let remaining = 0
  let inMember = false
  for await (const block of expandedBlocks(file, limits)) {
    if (Date.now() > deadline) throw new ArchiveRejected("archive read exceeded the time bound")
    if (inMember) {
      const take = Math.min(remaining, blockSize)
      if (take > 0) await sink.data(block.subarray(0, take))
      remaining -= take
      if (remaining === 0) {
        await sink.end()
        inMember = false
      }
      continue
    }
    if (isZeroBlock(block)) {
      zeroBlocks += 1
      continue
    }
    if (zeroBlocks > 0) {
      throw new ArchiveRejected(zeroBlocks >= 2
        ? "archive carries data after the end-of-archive marker"
        : "archive carries a stray zero block")
    }
    entries += 1
    if (entries > limits.maxMembers) throw new ArchiveRejected("archive exceeds the member bound")
    const header = parseHeader(block)
    assertAllowedMember(header.path, header.directory)
    if (seen.has(header.path)) throw new ArchiveRejected(`duplicate member: ${header.path}`)
    seen.add(header.path)
    if (header.directory) continue
    if (header.byteLength > limits.maxMemberBytes) {
      throw new ArchiveRejected(`member exceeds the size bound: ${header.path}`)
    }
    const member: ArchiveMember = { path: header.path, byteLength: header.byteLength }
    members.push(member)
    await sink.begin(member)
    remaining = header.byteLength
    inMember = true
    if (remaining === 0) {
      await sink.end()
      inMember = false
    }
  }
  if (inMember) throw new ArchiveRejected("archive is truncated inside a member")
  if (zeroBlocks < 2) throw new ArchiveRejected("archive is missing its end-of-archive marker")
  return members
}

/**
 * The same walk, hashing every member instead of writing it.
 *
 * This is what makes a produced archive verifiable without extracting it twice: the
 * backup re-reads the artifact it just wrote and compares these digests with the
 * manifest it staged. Drift between the hand-written ustar headers and this reader
 * would otherwise surface at the first restore, months later.
 */
export const digestArchive = async (
  file: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<ReadonlyArray<ArchiveMember & { readonly sha256: string }>> => {
  const digests: Array<ArchiveMember & { readonly sha256: string }> = []
  let hash = createHash("sha256")
  let current: ArchiveMember | undefined
  await readArchive(file, {
    begin: (member) => {
      hash = createHash("sha256")
      current = member
      return Promise.resolve()
    },
    data: (chunk) => {
      hash.update(chunk)
      return Promise.resolve()
    },
    end: () => {
      if (current !== undefined) digests.push({ ...current, sha256: hash.digest("hex") })
      current = undefined
      return Promise.resolve()
    },
  }, limits)
  return digests
}

/** Read-only. Returns the members a later extraction is allowed to write. */
export const inspectArchive = async (
  file: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<ReadonlyArray<ArchiveMember>> => readArchive(file, countingSink, limits)

/**
 * Writes, and only ever after `inspectArchive` accepted the same file. It
 * re-validates on the way through rather than trusting the first pass, so a file
 * swapped between the two passes is refused mid-stream instead of extracted.
 */
export const extractArchive = async (
  file: string,
  staging: string,
  limits: ArchiveLimits = defaultArchiveLimits,
): Promise<ReadonlyArray<ArchiveMember>> => readArchive(file, extractionSink(staging), limits)
