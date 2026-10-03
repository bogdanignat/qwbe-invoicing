import type { IssuerBranding } from "./draft-models.ts"

/**
 * What the settings screen may accept as a logo, as plain functions over the
 * facts a file carries.
 *
 * Every limit here is the backend's own
 * (`standalone/api/branding-normalizer.ts:7`): 256 KiB, 2048 px per axis, four
 * megapixels, PNG or JPEG. They are re-stated in the browser so a rejection is
 * immediate and legible instead of a `400` after a 350 KB upload — not as the
 * authority, which stays the server.
 *
 * The answers are values, not exceptions, so each rule is tested without a DOM
 * and the screen only has to place the sentence this names.
 */
export const ISSUER_BRAND_TEXT_MAX_CODE_POINTS = 80
export const ISSUER_BRAND_IMAGE_MAX_BYTES = 256 * 1024
export const ISSUER_BRAND_IMAGE_MAX_AXIS = 2048
export const ISSUER_BRAND_IMAGE_MAX_PIXELS = 4_000_000

export type RasterMime = "image/png" | "image/jpeg"

export interface BrandingImageDraft {
  readonly dataBase64: string
  /** A `data:` URL, so the preview needs no object URL to revoke. */
  readonly previewUrl: string
  readonly width: number
  readonly height: number
}

export type BrandingFileCheck =
  | { readonly kind: "ready"; readonly mime: RasterMime }
  | { readonly kind: "issue"; readonly message: string }

/** The saved logo as a draft: the stored PNG is its own preview. */
export const savedBrandingImage = (branding: IssuerBranding | null): BrandingImageDraft | null => {
  const image = branding === null ? null : branding.image
  return image === null ? null : {
    dataBase64: image.pngBase64,
    previewUrl: `data:image/png;base64,${image.pngBase64}`,
    width: image.width,
    height: image.height,
  }
}

export const savedBrandText = (branding: IssuerBranding | null): string =>
  branding === null ? "" : branding.text ?? ""

/** `null` is "no brand text", which is how an empty field is sent. */
export const brandTextValue = (value: string): string | null => {
  const text = value.trim()
  return text === "" ? null : text
}

export const brandTextIssue = (value: string): string | undefined => {
  const text = value.trim()
  if (Array.from(text).length > ISSUER_BRAND_TEXT_MAX_CODE_POINTS) {
    return "Textul de brand poate avea maximum 80 de caractere."
  }
  return /\p{C}/u.test(text) ? "Textul de brand nu poate conține caractere de control." : undefined
}

/**
 * The encoding the bytes actually are, read from their signature. A declared
 * type is a claim by the browser; this is the file.
 */
export const detectRasterMime = (bytes: Uint8Array): RasterMime | null => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return "image/png"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  return null
}

/** What can be known before the bytes are read: the declared type and the size. */
export const brandingFileInfoIssue = (declaredMime: string, size: number): string | undefined => {
  if (declaredMime !== "image/png" && declaredMime !== "image/jpeg") return "Alege o imagine PNG sau JPEG."
  return size > ISSUER_BRAND_IMAGE_MAX_BYTES ? "Imaginea poate avea maximum 256 KiB." : undefined
}

export const brandingFileCheck = (declaredMime: string, size: number, bytes: Uint8Array): BrandingFileCheck => {
  const info = brandingFileInfoIssue(declaredMime, size)
  if (info !== undefined) return { kind: "issue", message: info }
  const detected = detectRasterMime(bytes)
  return detected === null || detected !== declaredMime
    ? { kind: "issue", message: "Conținutul fișierului nu corespunde unei imagini PNG sau JPEG valide." }
    : { kind: "ready", mime: detected }
}

export const brandingDimensionsIssue = (width: number, height: number): string | undefined =>
  Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= ISSUER_BRAND_IMAGE_MAX_AXIS && height <= ISSUER_BRAND_IMAGE_MAX_AXIS
    && width * height <= ISSUER_BRAND_IMAGE_MAX_PIXELS
    ? undefined
    : "Imaginea poate avea maximum 2048 px pe axă și 4 megapixeli."

/**
 * Why a save must not start yet. A file still being validated is not a refusal
 * of the form, it is a reason to wait; a file already refused must be replaced
 * or discarded, because sending the previous logo under an edited profile would
 * save something the screen is not showing.
 */
export const brandingImageSaveIssue = (pending: boolean, error: string | undefined): string | undefined =>
  pending ? "Așteaptă validarea imaginii înainte de salvare." : error
