import { crc32, deflateRawSync } from "node:zlib"

/**
 * Writes ZIP archives in ANAF's layout for the reader's tests: by default each
 * entry is deflated with flags 0x0808, zeros in the local header, a signed data
 * descriptor after the data, then the central directory and the end record.
 * Every field the reader checks can be bent per entry, and the three records are
 * exported so a test can lay out an archive by hand (entries that overlap).
 */
export interface ZipFile {
  readonly name: string
  readonly content: Uint8Array | string
  readonly method?: number
  readonly flags?: number
  /** The name written in the local header, when it should differ from the central one. */
  readonly localName?: string
  /** The CRC and uncompressed size declared in the central directory and the descriptor; the real ones by default. */
  readonly crc?: number
  readonly size?: number
  /** Whether the data descriptor starts with `PK\x07\x08` (16 bytes, ANAF's way) or not (12 bytes). */
  readonly signedDescriptor?: boolean
}

const bytesOf = (content: Uint8Array | string): Uint8Array =>
  typeof content === "string" ? new TextEncoder().encode(content) : content

const record = (length: number, write: (view: DataView) => void, ...tails: ReadonlyArray<Uint8Array>): Uint8Array => {
  const head = new Uint8Array(length)
  write(new DataView(head.buffer))
  return Buffer.concat([head, ...tails])
}

const shape = (file: ZipFile) => {
  const content = bytesOf(file.content)
  const method = file.method ?? 8
  const stored = method === 8 ? deflateRawSync(content) : content
  return {
    method, stored, flags: file.flags ?? 0x0808,
    crc: file.crc ?? crc32(content), size: file.size ?? content.length,
    name: bytesOf(file.name), localName: bytesOf(file.localName ?? file.name),
  }
}

/** Local header, data and (with flag 0x0008) the signed data descriptor. */
export const localRecord = (file: ZipFile): Uint8Array => {
  const entry = shape(file)
  const descriptor = (entry.flags & 0x0008) !== 0
  const local = record(30, (view) => {
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, entry.flags, true)
    view.setUint16(8, entry.method, true)
    if (!descriptor) {
      view.setUint32(14, entry.crc, true)
      view.setUint32(18, entry.stored.length, true)
      view.setUint32(22, entry.size, true)
    }
    view.setUint16(26, entry.localName.length, true)
  }, entry.localName, entry.stored)
  if (!descriptor) return local
  const fields = record(12, (view) => {
    view.setUint32(0, entry.crc, true)
    view.setUint32(4, entry.stored.length, true)
    view.setUint32(8, entry.size, true)
  })
  if (file.signedDescriptor === false) return Buffer.concat([local, fields])
  return Buffer.concat([local, record(4, (view) => { view.setUint32(0, 0x08074b50, true) }), fields])
}

export const centralRecord = (file: ZipFile, offset: number): Uint8Array => {
  const entry = shape(file)
  return record(46, (view) => {
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, entry.flags, true)
    view.setUint16(10, entry.method, true)
    view.setUint32(16, entry.crc, true)
    view.setUint32(20, entry.stored.length, true)
    view.setUint32(24, entry.size, true)
    view.setUint16(28, entry.name.length, true)
    view.setUint32(42, offset, true)
  }, entry.name)
}

export const endRecord = (count: number, directorySize: number, directoryOffset: number): Uint8Array => record(22, (view) => {
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, count, true)
  view.setUint16(10, count, true)
  view.setUint32(12, directorySize, true)
  view.setUint32(16, directoryOffset, true)
})

export const buildZip = (files: ReadonlyArray<ZipFile>): Buffer => {
  const locals = files.map(localRecord)
  const offsets = locals.map((_, index) => locals.slice(0, index).reduce((total, local) => total + local.length, 0))
  const directory = Buffer.concat(files.map((file, index) => centralRecord(file, offsets[index] ?? 0)))
  const directoryOffset = locals.reduce((total, local) => total + local.length, 0)
  return Buffer.concat([...locals, directory, endRecord(files.length, directory.length, directoryOffset)])
}

/** Where the n-th central directory record starts (records without extra fields or comments, as written above). */
export const centralOffset = (zip: Buffer, index: number): number => {
  let at = zip.readUInt32LE(zip.length - 6)
  for (let skipped = 0; skipped < index; skipped += 1) at += 46 + zip.readUInt16LE(at + 28)
  return at
}

/** The end record's offset in an archive without a comment. */
export const endOffset = (zip: Buffer): number => zip.length - 22
