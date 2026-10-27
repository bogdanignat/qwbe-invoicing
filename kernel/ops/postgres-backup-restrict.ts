import { createReadStream } from "node:fs"

import { ArchiveRejected } from "./postgres-backup-paths.ts"

/**
 * `database.sql` held to the one shape psql runs without its meta-commands.
 *
 * `psql --file` executes a backslash meta-command (`\!`, `\copy ... PROGRAM`,
 * `\o |cmd`) wherever an unquoted backslash starts one, so a hostile dump would run
 * shell commands in the `migrate` container. pg_dump 16.10+ wraps its output in
 * `\restrict <key>` ... `\unrestrict <key>`, and in between psql refuses every
 * meta-command except the matching `\unrestrict`. This scan proves, in one streaming
 * pass and without parsing SQL, that the wrapper covers the whole file:
 * - before `\restrict <key>` (63 alphanumerics, as pg_dump writes it) there are only
 *   blank lines and `--` comments;
 * - a `\unrestrict` psql could read as a command — after an odd run of backslashes,
 *   anywhere in a line — appears once, as the last non-blank line, with that key.
 *   COPY data doubles its backslashes, so `\\unrestrict` there is text, and psql
 *   refuses it outside COPY too (`\\` is a meta-command of its own);
 * - no NUL byte, which would make psql's lines differ from the ones judged here.
 *
 * Fail-closed: a rare false refusal is accepted, a false acceptance is not.
 */

const nul = 0x00
const newline = 0x0a
const backslash = 0x5c
const unrestrict = Buffer.from("unrestrict")
/** Longer than any line the scan has to read whole: `\unrestrict ` and a 63-character key. */
const keptBytes = 128
const restrictLine = /^\\restrict ([A-Za-z0-9]{63})$/u
const blankLine = /^[ \t\r]*$/u

const refused = (reason: string): ArchiveRejected =>
  new ArchiveRejected(`database.sql ${reason}; only a pg_dump 16.10+ dump in psql's restricted mode is restored`)

export interface RestrictScan {
  readonly feed: (chunk: Buffer) => void
  readonly finish: () => void
}

export const restrictScan = (): RestrictScan => {
  let key: string | undefined
  let closed = false
  const head = Buffer.alloc(keptBytes + 1)
  let length = 0
  let commands = 0
  let oddRun = false
  let matched = -1

  const judge = (text: string, whole: boolean): void => {
    const blank = whole && blankLine.test(text)
    if (key === undefined) {
      if (blank || text.startsWith("--")) return
      const opening = whole ? restrictLine.exec(text) : null
      if (opening === null) throw refused("does not open with a \\restrict line before any other command")
      key = opening[1]
      return
    }
    if (blank) return
    if (closed) throw refused("continues after \\unrestrict, outside psql's restricted mode")
    if (commands === 0) return
    if (commands > 1 || !whole || text !== `\\unrestrict ${key}`) {
      throw refused("carries a \\unrestrict that is not the closing line with the \\restrict key")
    }
    closed = true
  }

  const endLine = (): void => {
    judge(head.toString("latin1", 0, Math.min(length, keptBytes)), length <= keptBytes)
    length = 0
    commands = 0
    oddRun = false
    matched = -1
  }

  const take = (byte: number): void => {
    // psql reads a line with fgets + strlen, so a NUL joins two of our lines into one of
    // its own. pg_dump never writes one; any NUL is refused.
    if (byte === nul) throw refused("contains a NUL byte")
    if (length < head.length) head[length] = byte
    length += 1
    if (matched >= 0 && byte === unrestrict[matched]) {
      matched += 1
      if (matched === unrestrict.length) {
        commands += 1
        matched = -1
      }
    } else {
      matched = oddRun && byte === unrestrict[0] ? 1 : -1
    }
    oddRun = byte === backslash && !oddRun
  }

  return {
    feed: (chunk) => {
      for (const byte of chunk) {
        if (byte === newline) endLine()
        else take(byte)
      }
    },
    finish: () => {
      if (length > 0) endLine()
      if (key === undefined) throw refused("has no \\restrict line")
      if (!closed) throw refused("does not end with the \\unrestrict line of its \\restrict key")
    },
  }
}

export const assertRestrictedDump = async (path: string): Promise<void> => {
  const scan = restrictScan()
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 16 })) scan.feed(chunk as Buffer)
  scan.finish()
}
