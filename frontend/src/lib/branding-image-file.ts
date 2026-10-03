import {
  brandingDimensionsIssue, brandingFileCheck, type BrandingImageDraft,
} from "./issuer-branding.ts"

/**
 * A chosen file turned into the draft the form sends, or the reason it cannot be.
 *
 * All three checks happen here, in this order: what the browser declares, what
 * the bytes are, and only then what the decoded raster measures — reading the
 * pixels of a file that is not an image at all would fail with a browser message
 * instead of ours.
 *
 * How the dimensions are read is a parameter with a browser default, so the
 * whole sequence is testable under Node: the default needs `createImageBitmap`
 * or an `Image`, the rule does not.
 */
export interface ImageSize {
  readonly width: number
  readonly height: number
}

export type ImageSizeReader = (blob: Blob) => Promise<ImageSize>

export type BrandingImageOutcome =
  | { readonly kind: "ready"; readonly draft: BrandingImageDraft }
  | { readonly kind: "issue"; readonly message: string }

/** Chunked so a 256 KiB logo never reaches the argument limit of `String.fromCharCode`. */
const base64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export const imageSize: ImageSizeReader = async (blob) => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob)
    try {
      return { width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Fișierul nu poate fi decodat ca imagine."))
    }
    image.src = url
  })
}

export const readBrandingImage = async (
  file: File,
  read: ImageSizeReader = imageSize,
): Promise<BrandingImageOutcome> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // The larger of the two sizes is checked: a `File` whose reported size
  // understates its bytes must not slip past the limit.
  const check = brandingFileCheck(file.type, Math.max(file.size, bytes.byteLength), bytes)
  if (check.kind === "issue") return check
  let size: ImageSize
  try {
    size = await read(new Blob([bytes], { type: check.mime }))
  } catch (cause) {
    return { kind: "issue", message: cause instanceof Error ? cause.message : "Imaginea nu a putut fi citită." }
  }
  const dimensions = brandingDimensionsIssue(size.width, size.height)
  if (dimensions !== undefined) return { kind: "issue", message: dimensions }
  const dataBase64 = base64(bytes)
  return {
    kind: "ready",
    draft: {
      dataBase64,
      previewUrl: `data:${check.mime};base64,${dataBase64}`,
      width: size.width,
      height: size.height,
    },
  }
}
