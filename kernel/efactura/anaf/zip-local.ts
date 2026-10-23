import { hasZip64Extra, refuseZip, type Central, type Reader, type ZipEntry } from "./zip-bytes.ts"

/**
 * An entry's local header, data and data descriptor, checked against its
 * central directory record: same signature, name, method and flags; the CRC
 * and sizes (in the header, or in the descriptor when flag 0x0008 says so)
 * equal to the central ones; everything before the central directory.
 */
const LOCAL = 0x04034b50
const DESCRIPTOR = 0x08074b50
const DATA_DESCRIPTOR_FLAG = 0x0008
const LOCAL_SIZE = 30

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

/** The entry's local header, data and descriptor: where they lie, checked against the central directory. */
export const localEntry = (read: Reader, central: Central, limit: number): { readonly entry: ZipEntry; readonly start: number; readonly end: number } => {
  const at = central.offset
  if (read.u32(at) !== LOCAL) refuseZip("header_mismatch")
  const flags = read.u16(at + 6)
  const nameLength = read.u16(at + 26)
  const extraLength = read.u16(at + 28)
  if (flags !== central.flags || read.u16(at + 8) !== central.entry.method || !sameBytes(read.slice(at + LOCAL_SIZE, nameLength), central.nameBytes)) {
    refuseZip("header_mismatch")
  }
  if (hasZip64Extra(read, at + LOCAL_SIZE + nameLength, extraLength)) refuseZip("zip64")
  const values = [central.entry.crc, central.compressedSize, central.entry.size]
  const dataStart = at + LOCAL_SIZE + nameLength + extraLength
  const dataEnd = dataStart + central.compressedSize
  let end = dataEnd
  if ((flags & DATA_DESCRIPTOR_FLAG) === 0) {
    if ([read.u32(at + 14), read.u32(at + 18), read.u32(at + 22)].some((value, index) => value !== values[index])) refuseZip("header_mismatch")
  } else {
    const fields = dataEnd + 4 <= limit && read.u32(dataEnd) === DESCRIPTOR ? dataEnd + 4 : dataEnd
    if ([read.u32(fields), read.u32(fields + 4), read.u32(fields + 8)].some((value, index) => value !== values[index])) refuseZip("header_mismatch")
    end = fields + 12
  }
  if (end > limit) refuseZip("out_of_bounds")
  return { entry: { ...central.entry, data: read.slice(dataStart, central.compressedSize) }, start: at, end }
}
