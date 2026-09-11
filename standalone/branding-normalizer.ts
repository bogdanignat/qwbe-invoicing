import { Effect } from "effect"
import sharp from "sharp"

import { ValidationFailure } from "../cube/invoicing/contracts/failures.ts"
import type { BrandingNormalizer } from "../cube/invoicing/contracts/host.ts"

const maxBytes = 256 * 1024
const maxPixels = 4_000_000
const maxDimension = 2048
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const invalidImage = (): ValidationFailure => new ValidationFailure({
  issues: ["branding.image must be a valid static PNG or JPEG, at most 256 KiB and 2048 px per axis (4 megapixels), including its normalized PNG"],
})

// Framing only: prevents animated/ambiguous input reaching the native decoder.
// Pixel decoding, CRC validation and encoding are handled by sharp/libvips.
const assertStaticPng = (bytes: Buffer): void => {
  let offset = pngSignature.length
  let sawPixels = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > bytes.length || (offset === 8 && (type !== "IHDR" || length !== 13))) throw invalidImage()
    if (type === "acTL" || type === "fcTL" || type === "fdAT") throw invalidImage()
    if (type === "IDAT") sawPixels = true
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length || !sawPixels) throw invalidImage()
      return
    }
    offset = end
  }
  throw invalidImage()
}

const assertDimensions = (width: number, height: number): void => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > maxDimension || height > maxDimension || width * height > maxPixels) throw invalidImage()
}

export const brandingNormalizer: BrandingNormalizer = {
  normalize: (input) => Effect.tryPromise({
    try: async () => {
      if (input.byteLength === 0 || input.byteLength > maxBytes) throw invalidImage()
      const bytes = Buffer.from(input)
      const isPng = bytes.subarray(0, pngSignature.length).equals(pngSignature)
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      // Do not let libvips select an SVG or other unrequested format loader.
      if (!isPng && !isJpeg) throw invalidImage()
      if (isPng) assertStaticPng(bytes)
      const image = sharp(bytes, { limitInputPixels: maxPixels, failOn: "warning", sequentialRead: true })
      const metadata = await image.metadata()
      if ((metadata.format !== "png" && metadata.format !== "jpeg") || (metadata.pages ?? 1) !== 1) throw invalidImage()
      assertDimensions(metadata.width, metadata.height)
      const { data, info } = await image.autoOrient().toColourspace("srgb")
        .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false, palette: false })
        .toBuffer({ resolveWithObject: true })
      assertDimensions(info.width, info.height)
      if (data.byteLength > maxBytes) throw invalidImage()
      return { pngBase64: data.toString("base64"), width: info.width, height: info.height }
    },
    catch: invalidImage,
  }),
}
