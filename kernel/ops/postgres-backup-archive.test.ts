import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync, symlinkSync, linkSync } from "node:fs"
import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { gzipSync } from "node:zlib"

import { inspectArchive, extractArchive } from "./postgres-backup-archive.ts"
import { verifyStaged, sha256Stream, writeManifest } from "./postgres-backup-manifest.ts"
import { ArchiveRejected, assertAllowedMember, safeMemberPath } from "./postgres-backup-paths.ts"
import { assertWithinLimits } from "./postgres-backup-verify.ts"
import { stageSource, validateSource } from "./postgres-backup-source.ts"
import { createRedactor } from "./postgres-backup-dump.ts"
import { defaultArchiveLimits } from "./postgres-backup-tar.ts"
import { writeArchive } from "./postgres-backup-writer.ts"

/**
 * The archive reader, judged on hostile input.
 *
 * Every fixture here is written byte by byte rather than by an archiver, because
 * the cases that matter are the ones no archiver produces: a header whose declared
 * size is longer than its content, a checksum that does not add up, a PAX record, a
 * name carrying a newline. The step-0 probe showed BusyBox `tar` extracting
 * `../escape.txt` as `escape.txt` and materialising a symlink member as given, so
 * the assertion that matters most is not only "refused" but "refused with the
 * staging directory still empty".
 */

const fixtureRoot = (): string => mkdtempSync(join(tmpdir(), "qwbe-archive-fixture-"))

interface RawMember {
  readonly name: string
  readonly type?: string
  readonly size?: number
  readonly content?: Buffer
  readonly prefix?: string
  readonly linkname?: string
  readonly magic?: string
  readonly breakChecksum?: boolean
}

const octalField = (value: number, length: number): Buffer => {
  const text = value.toString(8).padStart(length - 1, "0")
  return Buffer.concat([Buffer.from(text, "latin1"), Buffer.alloc(1)])
}

const rawHeader = (member: RawMember): Buffer => {
  const block = Buffer.alloc(512)
  Buffer.from(member.name, "utf8").copy(block, 0)
  octalField(0o600, 8).copy(block, 100)
  octalField(0, 8).copy(block, 108)
  octalField(0, 8).copy(block, 116)
  octalField(member.size ?? member.content?.length ?? 0, 12).copy(block, 124)
  octalField(0, 12).copy(block, 136)
  block.fill(32, 148, 156)
  block.write(member.type ?? "0", 156, "latin1")
  if (member.linkname !== undefined) Buffer.from(member.linkname, "latin1").copy(block, 157)
  Buffer.from(member.magic ?? "ustar\0", "latin1").copy(block, 257)
  Buffer.from("00", "latin1").copy(block, 263)
  if (member.prefix !== undefined) Buffer.from(member.prefix, "latin1").copy(block, 345)
  let sum = 0
  for (const byte of block) sum += byte
  octalField(member.breakChecksum === true ? sum + 1 : sum, 8).copy(block, 148)
  return block
}

const padded = (content: Buffer): Buffer => {
  const remainder = content.length % 512
  return remainder === 0 ? content : Buffer.concat([content, Buffer.alloc(512 - remainder)])
}

interface RawArchive {
  readonly members: ReadonlyArray<RawMember>
  readonly endBlocks?: number
  readonly trailing?: Buffer
}

const rawArchive = (archive: RawArchive): Buffer => {
  const parts: Array<Buffer> = []
  for (const member of archive.members) {
    parts.push(rawHeader(member))
    const content = member.content ?? Buffer.alloc(0)
    if (content.length > 0) parts.push(padded(content))
  }
  parts.push(Buffer.alloc(512 * (archive.endBlocks ?? 2)))
  if (archive.trailing !== undefined) parts.push(archive.trailing)
  return gzipSync(Buffer.concat(parts))
}

const written = (archive: RawArchive, root: string, name = "hostile.tar.gz"): string => {
  const path = join(root, name)
  writeFileSync(path, rawArchive(archive))
  return path
}

const manifestMember = (files: ReadonlyArray<{ path: string; sha256: string; byteLength: number }>): Buffer =>
  Buffer.from(`${JSON.stringify({
    createdAt: "2026-10-01T00:00:00.000Z",
    dataDirectory: "/data",
    database: "invoicing",
    serverVersion: "16.15",
    dumpVersion: "pg_dump (PostgreSQL) 16.15",
    dumpFormat: "plain",
    excludedTableData: ["public.browser_sessions"],
    schemaMigrations: ["000-foundation"],
    files,
  }, null, 2)}\n`, "utf8")

const rejects = async (run: () => Promise<unknown>, expected: RegExp): Promise<void> => {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ArchiveRejected, `expected ArchiveRejected, got ${String(error)}`)
    assert.match(error.message, expected)
    return true
  })
}

void test("the member whitelist refuses names no archive should carry", () => {
  const cases: ReadonlyArray<readonly [string, RegExp]> = [
    ["", /member name is empty/],
    ["manifest\0.json", /member name contains NUL/],
    ["data\nbase.sql", /member name contains a control character/],
    ["artifacts\\sha256", /member name contains a backslash/],
    ["/database.sql", /member name is absolute/],
    ["../database.sql", /member name traverses/],
    ["artifacts/../database.sql", /member name traverses/],
    ["artifacts//database.sql", /member name has an empty segment/],
    ["notes.txt", /member is not part of the layout/],
    ["artifacts/sha256/ab/NOTHEX.pdf", /member is not part of the layout/],
    [`artifacts/sha256/ab/${"a".repeat(64)}.exe`, /member is not part of the layout/],
    ["a".repeat(101), /member name is too long/],
  ]
  for (const [path, expected] of cases) {
    assert.throws(() => { assertAllowedMember(path, false) }, expected, path)
  }
  assertAllowedMember("manifest.json", false)
  assertAllowedMember("database.sql", false)
  assertAllowedMember(`artifacts/sha256/ab/${"0".repeat(64)}.pdf`, false)
  assertAllowedMember("artifacts/sha256/ab", true)
  assert.throws(() => { assertAllowedMember("artifacts/sha256/ab", false) }, /not part of the layout/)
  assert.throws(() => { assertAllowedMember("artifacts/sha256/ab/x", true) }, /directory is not part of the layout/)
})

void test("safeMemberPath keeps every accepted name under the staging root", () => {
  const root = "/stage"
  assert.equal(safeMemberPath(root, "manifest.json"), "/stage/manifest.json")
  assert.throws(() => safeMemberPath(root, "../manifest.json"), /escapes the staging root/)
})

void test("the reader refuses every hostile member type and shape", async () => {
  const root = fixtureRoot()
  try {
    const cases: ReadonlyArray<readonly [string, RawArchive, RegExp]> = [
      ["unknown name", { members: [{ name: "notes.txt", content: Buffer.from("x") }] }, /not part of the layout/],
      ["absolute name", { members: [{ name: "/database.sql", content: Buffer.from("x") }] }, /is absolute/],
      ["dot dot", { members: [{ name: "../database.sql", content: Buffer.from("x") }] }, /traverses/],
      ["newline", { members: [{ name: "data\nbase.sql", content: Buffer.from("x") }] }, /control character/],
      ["backslash", { members: [{ name: "artifacts\\x", content: Buffer.from("x") }] }, /backslash/],
      ["duplicate", {
        members: [
          { name: "database.sql", content: Buffer.from("a") },
          { name: "database.sql", content: Buffer.from("b") },
        ],
      }, /duplicate member/],
      ["hard link", { members: [{ name: "database.sql", type: "1", linkname: "manifest.json" }] }, /hard link/],
      ["symlink", { members: [{ name: "database.sql", type: "2", linkname: "/etc/passwd" }] }, /symbolic link/],
      ["character device", { members: [{ name: "database.sql", type: "3" }] }, /character device/],
      ["block device", { members: [{ name: "database.sql", type: "4" }] }, /block device/],
      ["fifo", { members: [{ name: "database.sql", type: "6" }] }, /FIFO/],
      ["pax extended", { members: [{ name: "PaxHeaders/x", type: "x", content: Buffer.from("x") }] }, /PAX extended header/],
      ["pax global", { members: [{ name: "pax_global_header", type: "g", content: Buffer.from("x") }] }, /PAX global header/],
      ["gnu long name", { members: [{ name: "././@LongLink", type: "L", content: Buffer.from("x") }] }, /GNU long name/],
      ["unknown flag", { members: [{ name: "database.sql", type: "Z" }] }, /member type is not allowed/],
      ["prefix", { members: [{ name: "database.sql", prefix: "artifacts", content: Buffer.from("x") }] }, /prefix is not supported/],
      ["link target on a regular file", {
        members: [{ name: "database.sql", linkname: "/etc/passwd", content: Buffer.from("x") }],
      }, /carries a link target/],
      ["bad magic", { members: [{ name: "database.sql", magic: "gnutar", content: Buffer.from("x") }] }, /not ustar/],
      ["bad checksum", {
        members: [{ name: "database.sql", content: Buffer.from("x"), breakChecksum: true }],
      }, /checksum is invalid/],
      ["truncated member", {
        members: [{ name: "database.sql", size: 4096, content: Buffer.from("short") }],
      }, /truncated inside a member/],
      ["missing end marker", {
        members: [{ name: "database.sql", content: Buffer.from("x") }], endBlocks: 1,
      }, /missing its end-of-archive marker/],
      ["no end marker at all", {
        members: [{ name: "database.sql", content: Buffer.from("x") }], endBlocks: 0,
      }, /missing its end-of-archive marker/],
      ["data after the marker", {
        members: [{ name: "database.sql", content: Buffer.from("x") }],
        trailing: Buffer.concat([rawHeader({ name: "manifest.json", content: Buffer.from("y") }), padded(Buffer.from("y"))]),
      }, /after the end-of-archive marker/],
      ["directory carrying content", {
        members: [{ name: "artifacts", type: "5", content: Buffer.from("x") }],
      }, /directory member carries content/],
    ]
    for (const [label, archive, expected] of cases) {
      const path = written(archive, root, `${label.replaceAll(" ", "-")}.tar.gz`)
      await rejects(() => inspectArchive(path), expected)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a truncated gzip stream and a stray block are refused, not tolerated", async () => {
  const root = fixtureRoot()
  try {
    const whole = rawArchive({ members: [{ name: "database.sql", content: Buffer.from("x") }] })
    const cut = join(root, "cut.tar.gz")
    writeFileSync(cut, whole.subarray(0, whole.length - 8))
    await assert.rejects(() => inspectArchive(cut))
    const stray = join(root, "stray.tar.gz")
    writeFileSync(stray, gzipSync(Buffer.concat([
      Buffer.alloc(512),
      rawHeader({ name: "database.sql", content: Buffer.from("x") }),
      padded(Buffer.from("x")),
      Buffer.alloc(1024),
    ])))
    await rejects(() => inspectArchive(stray), /stray zero block/)
    const partial = join(root, "partial-block.tar.gz")
    writeFileSync(partial, gzipSync(Buffer.alloc(300)))
    await rejects(() => inspectArchive(partial), /truncated mid-block/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the bounds refuse a decompression bomb, too many members and an oversized member", async () => {
  const root = fixtureRoot()
  try {
    const bomb = join(root, "bomb.tar.gz")
    writeFileSync(bomb, gzipSync(Buffer.alloc(4 * 1024 * 1024)))
    await rejects(
      () => inspectArchive(bomb, { ...defaultArchiveLimits, maxExpandedBytes: 64 * 1024 }),
      /expanded archive exceeds the bound/,
    )
    await rejects(
      () => inspectArchive(bomb, { ...defaultArchiveLimits, maxCompressedBytes: 16 }),
      /compressed input exceeds the bound/,
    )
    const many = written({
      members: [
        { name: "manifest.json", content: Buffer.from("{}") },
        { name: "database.sql", content: Buffer.from("x") },
      ],
    }, root, "many.tar.gz")
    await rejects(
      () => inspectArchive(many, { ...defaultArchiveLimits, maxMembers: 1 }),
      /exceeds the member bound/,
    )
    await rejects(
      () => inspectArchive(many, { ...defaultArchiveLimits, maxMemberBytes: 1 }),
      /exceeds the size bound/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a rejected archive leaves the staging directory untouched", async () => {
  const root = fixtureRoot()
  try {
    const hostile = written({
      members: [
        { name: "manifest.json", content: manifestMember([]) },
        { name: "database.sql", content: Buffer.from("SELECT 1;\n") },
        { name: "database.sql", type: "2", linkname: "/etc/passwd" },
      ],
    }, root)
    const staging = join(root, "staging")
    await mkdir(staging, { recursive: true })
    await rejects(() => stageSource(hostile, staging), /duplicate member|symbolic link/)
    assert.deepEqual(await readdir(staging), [], "nothing may be written before the archive is accepted")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a valid archive round-trips byte for byte through the writer and the reader", async () => {
  const root = fixtureRoot()
  try {
    const source = join(root, "source")
    const digest = "b".repeat(64)
    await mkdir(join(source, "artifacts", "sha256", digest.slice(0, 2)), { recursive: true })
    const pdf = `artifacts/sha256/${digest.slice(0, 2)}/${digest}.pdf`
    await writeFile(join(source, "database.sql"), "SELECT 1;\n".repeat(400))
    await writeFile(join(source, pdf), Buffer.from("%PDF-1.7 fixture"))
    const sized = []
    for (const path of ["database.sql", pdf]) {
      sized.push({
        path,
        sha256: await sha256Stream(join(source, path)),
        byteLength: (await stat(join(source, path))).size,
      })
    }
    await writeManifest(source, {
      createdAt: "2026-10-01T00:00:00.000Z",
      dataDirectory: source,
      database: "invoicing",
      serverVersion: "16.15",
      dumpVersion: "pg_dump (PostgreSQL) 16.15",
      dumpFormat: "plain",
      excludedTableData: ["public.browser_sessions"],
      schemaMigrations: ["000-foundation"],
      files: sized,
    })
    const archive = join(root, "backup.tar.gz")
    await writeArchive(source, ["manifest.json", "database.sql", pdf], archive)
    const members = await inspectArchive(archive)
    assert.deepEqual([...members.map((member) => member.path)].sort(), ["database.sql", "manifest.json", pdf].sort())
    const staging = join(root, "staging")
    await mkdir(staging, { recursive: true })
    const staged = await extractArchive(archive, staging)
    const manifest = await verifyStaged(staging, staged)
    assert.equal(manifest.dumpFormat, "plain")
    for (const file of sized) {
      assert.equal(await sha256Stream(join(staging, file.path)), file.sha256, file.path)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the manifest is checked in both directions", async () => {
  const root = fixtureRoot()
  try {
    const staging = join(root, "staging")
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, "database.sql"), "SELECT 1;\n")
    const digest = await sha256Stream(join(staging, "database.sql"))
    writeFileSync(join(staging, "manifest.json"), manifestMember([
      { path: "database.sql", sha256: "0".repeat(64), byteLength: 10 },
    ]))
    await rejects(
      () => verifyStaged(staging, [{ path: "manifest.json", byteLength: 1 }, { path: "database.sql", byteLength: 10 }]),
      /integrity mismatch for database.sql/,
    )
    writeFileSync(join(staging, "manifest.json"), manifestMember([
      { path: "database.sql", sha256: digest, byteLength: 10 },
    ]))
    const extra = `artifacts/sha256/cc/${"c".repeat(64)}.pdf`
    await rejects(
      () => verifyStaged(staging, [
        { path: "manifest.json", byteLength: 1 },
        { path: "database.sql", byteLength: 10 },
        { path: extra, byteLength: 1 },
      ]),
      /the manifest does not list/,
    )
    await rejects(
      () => verifyStaged(staging, [{ path: "database.sql", byteLength: 10 }]),
      /manifest.json is missing/,
    )
    writeFileSync(join(staging, "manifest.json"), "{\"files\":[]}")
    await rejects(
      () => verifyStaged(staging, [{ path: "manifest.json", byteLength: 1 }, { path: "database.sql", byteLength: 10 }]),
      /unsupported dump format/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a directory input is held to the same guarantees as an archive", async () => {
  const root = fixtureRoot()
  try {
    const input = join(root, "input")
    mkdirSync(input, { recursive: true })
    writeFileSync(join(input, "database.sql"), "SELECT 1;\n")
    writeFileSync(join(input, "manifest.json"), manifestMember([]))
    writeFileSync(join(root, "outside.txt"), "x")
    symlinkSync("/etc/passwd", join(input, "link"))
    await rejects(() => validateSource(input), /symbolic link/)
    rmSync(join(input, "link"))
    symlinkSync(join(root, "outside.txt"), join(input, "notes.txt"))
    await rejects(() => validateSource(input), /symbolic link/)
    rmSync(join(input, "notes.txt"))
    linkSync(join(input, "database.sql"), join(root, "alias.sql"))
    await rejects(() => validateSource(input), /hard-linked/)
    rmSync(join(root, "alias.sql"))
    const members = await validateSource(input)
    assert.deepEqual([...members.map((member) => member.path)].sort(), ["database.sql", "manifest.json"])
    const staging = join(root, "staging")
    mkdirSync(staging, { recursive: true })
    await stageSource(input, staging)
    assert.deepEqual([...readdirSync(staging)].sort(), ["database.sql", "manifest.json"])
    await rejects(() => validateSource(join(root, "outside.txt")), /must be a directory or \.tar\.gz/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a truncated gzip stream is refused as unacceptable input, not as an internal defect", async () => {
  const root = fixtureRoot()
  try {
    const whole = rawArchive({ members: [{ name: "database.sql", content: Buffer.from("x".repeat(2048)) }] })
    const cut = join(root, "cut.tar.gz")
    writeFileSync(cut, whole.subarray(0, whole.length - 8))
    await rejects(() => inspectArchive(cut), /not a readable gzip stream/)
    const garbage = join(root, "garbage.tar.gz")
    writeFileSync(garbage, Buffer.from("this is not gzip at all"))
    await rejects(() => inspectArchive(garbage), /not a readable gzip stream/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("rejecting many archives leaks no file descriptor", async () => {
  const root = fixtureRoot()
  try {
    const hostile = written({ members: [{ name: "database.sql", type: "2", linkname: "/etc/passwd" }] }, root)
    const open = async (): Promise<number> => (await readdir("/proc/self/fd")).length
    for (let index = 0; index < 20; index += 1) await rejects(() => inspectArchive(hostile), /symbolic link/)
    const before = await open()
    for (let index = 0; index < 60; index += 1) await rejects(() => inspectArchive(hostile), /symbolic link/)
    const after = await open()
    assert.ok(after <= before + 4, `descriptors grew from ${String(before)} to ${String(after)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the redactor removes a secret split across chunks and across the output cap", () => {
  const secret = "s3cr3t-password"
  const split = createRedactor(secret, 1024)
  split.feed("connecting with s3cr3t-")
  split.feed("password now")
  assert.equal(split.text(), "connecting with [redacted] now")
  assert.ok(!split.text().includes("s3cr3t"))

  // The secret straddles the cap: the naive order (cap, then strip) would leave its
  // prefix in the message, because the tail it needs to match was already cut.
  const cap = 40
  const boundary = createRedactor(secret, cap)
  boundary.feed("A".repeat(cap - 5))
  boundary.feed(secret)
  boundary.feed("B".repeat(4096))
  const text = boundary.text()
  assert.ok(!text.includes("s3cr3t"), `secret prefix survived: ${text}`)
  assert.ok(text.length <= cap)

  const perChunk = createRedactor(secret, 64)
  for (const character of `${secret}!`) perChunk.feed(character)
  assert.equal(perChunk.text(), "[redacted]!")

  const none = createRedactor("", 16)
  none.feed("plain output")
  assert.equal(none.text(), "plain output")
})

void test("a filesystem error is not reported as an invalid archive", async () => {
  const root = fixtureRoot()
  try {
    // ENOENT is an internal failure (CLI exit 1), not "your archive is unacceptable"
    // (exit 2) — the read-back a backup performs reads a file the operator never gave.
    await assert.rejects(
      () => inspectArchive(join(root, "absent.tar.gz")),
      (error: unknown) => {
        assert.ok(!(error instanceof ArchiveRejected), "an fs error must keep its own identity")
        assert.match(String((error as { code?: string }).code), /ENOENT/u)
        return true
      },
    )
    // While a zlib failure on a file that does exist still is one.
    const garbage = join(root, "garbage.tar.gz")
    writeFileSync(garbage, Buffer.from("not gzip"))
    await rejects(() => inspectArchive(garbage), /not a readable gzip stream/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a leftover artifact-store temporary is diagnosed, not just refused", () => {
  const digest = "7".repeat(64)
  const uuid = "0123abcd-4567-89ef-0123-456789abcdef"
  const temporary = `artifacts/sha256/${digest.slice(0, 2)}/.${digest}.${uuid}.tmp`
  assert.throws(() => { assertAllowedMember(temporary, false) }, (error: unknown) => {
    assert.ok(error instanceof ArchiveRejected)
    assert.match(error.message, /leftover temporary file of the artifact store/u)
    assert.match(error.message, /remove that one file and run again/u)
    assert.ok(error.message.includes(temporary), "the refusal must name the file")
    return true
  })
  // The whitelist is not relaxed: a real PDF still passes, anything else still fails
  // with the generic refusal.
  assertAllowedMember(`artifacts/sha256/${digest.slice(0, 2)}/${digest}.pdf`, false)
  assert.throws(
    () => { assertAllowedMember(`artifacts/sha256/${digest.slice(0, 2)}/${digest}.tmp`, false) },
    /member is not part of the layout/,
  )
})

void test("the writer bounds include the tar framing the reader counts", async () => {
  const root = fixtureRoot()
  try {
    const staging = join(root, "staging")
    await mkdir(staging, { recursive: true })
    // One member of exactly one block: content 512, framed 512 header + 512 content
    // + 1024 end marker = 2048. A bound of 2047 must refuse, 2048 must pass, and the
    // reader must agree with whatever the writer let through.
    await writeFile(join(staging, "database.sql"), "x".repeat(512))
    const files = [{
      path: "database.sql",
      sha256: await sha256Stream(join(staging, "database.sql")),
      byteLength: 512,
    }]
    assert.throws(
      () => { assertWithinLimits(files, { ...defaultArchiveLimits, maxExpandedBytes: 2047 }) },
      /including tar framing, over the bound of 2047/,
    )
    assertWithinLimits(files, { ...defaultArchiveLimits, maxExpandedBytes: 2048 })
    const archive = join(root, "framed.tar.gz")
    await writeArchive(staging, ["database.sql"], archive)
    const members = await inspectArchive(archive, { ...defaultArchiveLimits, maxExpandedBytes: 2048 })
    assert.deepEqual(members.map((member) => member.path), ["database.sql"])
    assert.throws(
      () => { assertWithinLimits(files, { ...defaultArchiveLimits, maxMemberBytes: 511 }) },
      /over the per-member bound of 511/,
    )
    assert.throws(
      () => { assertWithinLimits(files, { ...defaultArchiveLimits, maxMembers: 0 }) },
      /over the bound of 0/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
