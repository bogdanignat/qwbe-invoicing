/**
 * The byte level of the ZIP reader: the refusals, an entry as the reader hands
 * it on, and bounded little-endian reads. Every read outside the buffer is a
 * refusal, never an exception of the platform or a value made up.
 */
export type ZipRefusal =
  | "too_large" | "truncated" | "multidisk" | "zip64" | "encrypted" | "method" | "too_many_entries" | "name" | "duplicate_name"
  | "out_of_bounds" | "overlap" | "header_mismatch" | "size_mismatch" | "crc" | "corrupt" | "no_invoice" | "ambiguous"

export class ZipRefused extends Error {
  readonly refusal: ZipRefusal
  constructor(refusal: ZipRefusal) {
    super(refusal)
    this.refusal = refusal
  }
}

export const refuseZip = (refusal: ZipRefusal): never => { throw new ZipRefused(refusal) }

export interface ZipEntry {
  readonly name: string
  readonly method: 0 | 8
  readonly crc: number
  readonly size: number
  /** The entry's bytes as stored (compressed when `method` is 8), a view into the archive. */
  readonly data: Uint8Array
}

/** An entry as its central directory record describes it, before its local header is checked. */
export interface Central {
  readonly entry: ZipEntry
  readonly nameBytes: Uint8Array
  readonly flags: number
  readonly compressedSize: number
  readonly offset: number
}

const ZIP64_EXTRA = 0x0001

export const reader = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    u16: (at: number): number => at >= 0 && at + 2 <= bytes.length ? view.getUint16(at, true) : refuseZip("out_of_bounds"),
    u32: (at: number): number => at >= 0 && at + 4 <= bytes.length ? view.getUint32(at, true) : refuseZip("out_of_bounds"),
    slice: (from: number, length: number): Uint8Array =>
      from + length <= bytes.length ? bytes.subarray(from, from + length) : refuseZip("out_of_bounds"),
  }
}
export type Reader = ReturnType<typeof reader>

/** Walks the extra fields, which must fill their area exactly, looking for a ZIP64 one. */
export const hasZip64Extra = (read: Reader, from: number, length: number): boolean => {
  const end = from + length
  let at = from
  while (at < end) {
    if (at + 4 > end) return refuseZip("corrupt")
    if (read.u16(at) === ZIP64_EXTRA) return true
    at += 4 + read.u16(at + 2)
  }
  return at === end ? false : refuseZip("corrupt")
}
