import { crc32, inflateRawSync } from "node:zlib"

import { ANAF_HTTP } from "./endpoints.ts"
import { ZipRefused, refuseZip, zipEntries, type ZipEntry, type ZipRefusal } from "./zip-directory.ts"

export type { ZipRefusal } from "./zip-directory.ts"

/**
 * The XML of a received invoice out of the ZIP that `descarcare` returned: the
 * one `.xml` entry that is not `semnatura_*`, and ANAF's signature when there
 * is one. Every entry is extracted within the limits below, stored entries
 * included, and must come out at exactly its declared size and CRC.
 */
export const RECEIVED_ZIP_LIMITS = {
  maxZipBytes: ANAF_HTTP.maxBodyBytes,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
} as const

export type ReceivedZip =
  | { readonly ok: true; readonly invoice: Uint8Array; readonly signature?: Uint8Array }
  | { readonly ok: false; readonly refusal: ZipRefusal }

const SIGNATURE_PREFIX = "semnatura_"

const isXml = (name: string): boolean => /\.xml$/iu.test(name)

/** Deflate never writes past the declared size: one byte more already stops it. */
const inflate = (entry: ZipEntry): Uint8Array => {
  try {
    return inflateRawSync(entry.data, { maxOutputLength: Math.max(entry.size, 1) })
  } catch (error) {
    return refuseZip(error instanceof RangeError ? "size_mismatch" : "corrupt")
  }
}

const extract = (entry: ZipEntry): Uint8Array => {
  const output = entry.method === 0 ? entry.data.slice() : inflate(entry)
  if (output.length !== entry.size) refuseZip("size_mismatch")
  if (crc32(output) !== entry.crc) refuseZip("crc")
  return output
}

const checkSizes = (entries: ReadonlyArray<ZipEntry>): void => {
  if (entries.some((entry) => entry.size > RECEIVED_ZIP_LIMITS.maxFileBytes)) refuseZip("too_large")
  if (entries.reduce((total, entry) => total + entry.size, 0) > RECEIVED_ZIP_LIMITS.maxTotalBytes) refuseZip("too_large")
}

const read = (bytes: Uint8Array): { readonly invoice: Uint8Array; readonly signature?: Uint8Array } => {
  if (bytes.length > RECEIVED_ZIP_LIMITS.maxZipBytes) refuseZip("too_large")
  const entries = zipEntries(bytes)
  checkSizes(entries)
  const extracted = entries.map((entry) => ({ name: entry.name, bytes: extract(entry) }))
  const xml = extracted.filter(({ name }) => isXml(name))
  const invoices = xml.filter(({ name }) => !name.startsWith(SIGNATURE_PREFIX))
  const signatures = xml.filter(({ name }) => name.startsWith(SIGNATURE_PREFIX))
  const invoice = invoices[0]
  if (invoice === undefined) return refuseZip("no_invoice")
  if (invoices.length > 1 || signatures.length > 1) refuseZip("ambiguous")
  const signature = signatures[0]
  return signature === undefined ? { invoice: invoice.bytes } : { invoice: invoice.bytes, signature: signature.bytes }
}

export const readReceivedZip = (bytes: Uint8Array): ReceivedZip => {
  try {
    return { ok: true, ...read(bytes) }
  } catch (error) {
    if (error instanceof ZipRefused) return { ok: false, refusal: error.refusal }
    throw error
  }
}
