import { hasZip64Extra, reader, refuseZip, type Central, type Reader, type ZipEntry } from "./zip-bytes.ts"
import { localEntry } from "./zip-local.ts"

export { ZipRefused, refuseZip, type ZipEntry, type ZipRefusal } from "./zip-bytes.ts"

/**
 * The structure of a ZIP that ANAF's `descarcare` returns, read from the
 * central directory and checked against each local header. ANAF writes its
 * entries with a data descriptor (flags 0x0808): the local header carries CRC
 * and sizes 0, so the central directory is the source of truth and the local
 * header must agree with it on signature, name, method and flags. Anything a
 * plain single-disk archive of at most four entries does not need is refused:
 * encryption, ZIP64, several disks, other methods, duplicates, bytes outside
 * the buffer and entries that overlap. Names are compared, never used as paths.
 */
export const MAX_ZIP_ENTRIES = 4

const END = 0x06054b50
const CENTRAL = 0x02014b50
const ZIP64_LOCATOR = 0x07064b50
const ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000
const UTF8_NAME_FLAG = 0x0800
const END_SIZE = 22
const CENTRAL_SIZE = 46

/** The end record, which must close the buffer exactly (its comment included). A cut archive has none. */
const endRecord = (bytes: Uint8Array, read: Reader): number => {
  const earliest = Math.max(0, bytes.length - END_SIZE - 0xffff)
  for (let at = bytes.length - END_SIZE; at >= earliest; at -= 1) {
    if (read.u32(at) === END && at + END_SIZE + read.u16(at + 20) === bytes.length) return at
  }
  return refuseZip("truncated")
}

const decodeName = (bytes: Uint8Array, flags: number): string => {
  if ((flags & UTF8_NAME_FLAG) === 0 && bytes.some((byte) => byte >= 0x80)) return refuseZip("name")
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return refuseZip("name")
  }
}

const centralEntry = (read: Reader, at: number): Central => {
  if (read.u32(at) !== CENTRAL) refuseZip("corrupt")
  const flags = read.u16(at + 8)
  const method = read.u16(at + 10)
  const compressedSize = read.u32(at + 20)
  const size = read.u32(at + 24)
  const nameLength = read.u16(at + 28)
  const extraLength = read.u16(at + 30)
  const offset = read.u32(at + 42)
  if ((flags & ENCRYPTION_FLAGS) !== 0) refuseZip("encrypted")
  if ([compressedSize, size, offset].includes(0xffffffff) || hasZip64Extra(read, at + CENTRAL_SIZE + nameLength, extraLength)) refuseZip("zip64")
  if (read.u16(at + 34) !== 0) refuseZip("multidisk")
  if (method !== 0 && method !== 8) return refuseZip("method")
  const nameBytes = read.slice(at + CENTRAL_SIZE, nameLength)
  const entry = { name: decodeName(nameBytes, flags), method, crc: read.u32(at + 16), size, data: new Uint8Array() } as const
  return { entry, nameBytes, flags, compressedSize, offset }
}

const centralLength = (read: Reader, at: number): number => CENTRAL_SIZE + read.u16(at + 28) + read.u16(at + 30) + read.u16(at + 32)

/** Every entry of the archive, in central directory order, or a refusal. */
export const zipEntries = (bytes: Uint8Array): ReadonlyArray<ZipEntry> => {
  const read = reader(bytes)
  const end = endRecord(bytes, read)
  if (end >= 20 && read.u32(end - 20) === ZIP64_LOCATOR) refuseZip("zip64")
  const count = read.u16(end + 10)
  const directorySize = read.u32(end + 12)
  const directoryOffset = read.u32(end + 16)
  if ([read.u16(end + 8), count].includes(0xffff) || [directorySize, directoryOffset].includes(0xffffffff)) refuseZip("zip64")
  if (read.u16(end + 4) !== 0 || read.u16(end + 6) !== 0 || read.u16(end + 8) !== count) refuseZip("multidisk")
  if (count > MAX_ZIP_ENTRIES) refuseZip("too_many_entries")
  if (directoryOffset + directorySize !== end) refuseZip("out_of_bounds")
  const centrals: Array<Central> = []
  let at = directoryOffset
  for (let index = 0; index < count; index += 1) {
    centrals.push(centralEntry(read, at))
    at += centralLength(read, at)
    if (at > end) refuseZip("out_of_bounds")
  }
  if (at !== end) refuseZip("corrupt")
  if (new Set(centrals.map(({ entry }) => entry.name)).size !== centrals.length) refuseZip("duplicate_name")
  const locals = centrals.map((central) => localEntry(read, central, directoryOffset))
  const spans = [...locals].sort((left, right) => left.start - right.start)
  if (spans.some((span, index) => index > 0 && span.start < (spans[index - 1]?.end ?? 0))) refuseZip("overlap")
  return locals.map(({ entry }) => entry)
}
