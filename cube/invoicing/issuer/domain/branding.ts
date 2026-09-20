import { ValidationFailure } from "../../contracts/failures.ts"
import type { IssuerBrandingImage } from "../../domain/invoice.ts"

const maximumImageBytes = 256 * 1024
const maximumBase64Characters = 349_528
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export const decodeStrictBase64 = (value: string): Uint8Array => {
  if (value.length === 0 || value.length > maximumBase64Characters || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new ValidationFailure({ issues: ["branding.image.dataBase64 must be strict base64 of at most 256 KiB"] })
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const byteLength = value.length / 4 * 3 - padding
  const finalDataIndex = value.length - padding - 1
  const finalBits = base64Alphabet.indexOf(value[finalDataIndex] ?? "")
  if (byteLength > maximumImageBytes || finalBits < 0
    || (padding === 2 && (finalBits & 15) !== 0) || (padding === 1 && (finalBits & 3) !== 0)) {
    throw new ValidationFailure({ issues: ["branding.image.dataBase64 must be strict base64 of at most 256 KiB"] })
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (let index = 0; index < value.length; index += 4) {
    const a = base64Alphabet.indexOf(value[index] ?? "")
    const b = base64Alphabet.indexOf(value[index + 1] ?? "")
    const c = value[index + 2] === "=" ? 0 : base64Alphabet.indexOf(value[index + 2] ?? "")
    const d = value[index + 3] === "=" ? 0 : base64Alphabet.indexOf(value[index + 3] ?? "")
    bytes[offset++] = (a << 2) | (b >> 4)
    if (offset < byteLength) bytes[offset++] = ((b & 15) << 4) | (c >> 2)
    if (offset < byteLength) bytes[offset++] = ((c & 3) << 6) | d
  }
  return bytes
}

export const validateCanonicalImage = (image: IssuerBrandingImage): void => {
  const bytes = decodeStrictBase64(image.pngBase64)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!Number.isInteger(image.width) || image.width < 1 || image.width > 2048
    || !Number.isInteger(image.height) || image.height < 1 || image.height > 2048 || image.width * image.height > 4_000_000
    || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new ValidationFailure({ issues: ["branding normalizer returned an invalid canonical PNG image"] })
  }
}
