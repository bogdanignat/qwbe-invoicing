import type { IssuerBranding } from "./models.ts"

export const issuerBrandTextMaxCodePoints = 80
export const issuerBrandImageMaxBytes = 256 * 1024
export const issuerBrandImageMaxAxis = 2048
export const issuerBrandImageMaxPixels = 4_000_000

export type RasterMime = "image/png" | "image/jpeg"

export interface BrandingImageDraft {
  readonly dataBase64: string
  readonly previewUrl: string
  readonly width: number
  readonly height: number
}

export interface BrandingDraft {
  readonly text: string
  readonly image: BrandingImageDraft | null
}

export const changeBrandText = (draft: BrandingDraft, text: string): BrandingDraft => ({ ...draft, text })
export const changeBrandImage = (draft: BrandingDraft, image: BrandingImageDraft): BrandingDraft => ({ ...draft, image })
export const removeBrandImage = (draft: BrandingDraft): BrandingDraft => ({ ...draft, image: null })
export const removeBranding = (): BrandingDraft => ({ text: "", image: null })

export const brandingDraftFromSaved = (branding: IssuerBranding | null): BrandingDraft => ({
  text: branding?.text ?? "",
  image: branding?.image === null || branding?.image === undefined ? null : {
    dataBase64: branding.image.pngBase64,
    previewUrl: `data:image/png;base64,${branding.image.pngBase64}`,
    width: branding.image.width,
    height: branding.image.height,
  },
})

export const normalizeBrandText = (value: string): string | null => {
  const normalized = value.trim()
  if (normalized === "") return null
  if (Array.from(normalized).length > issuerBrandTextMaxCodePoints) throw new Error("Textul de brand poate avea maximum 80 de caractere.")
  if (/\p{Cc}/u.test(normalized)) throw new Error("Textul de brand nu poate conține caractere de control.")
  return normalized
}

export const detectRasterMime = (bytes: Uint8Array): RasterMime | null => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  return null
}

export const validateBrandingFileInfo = (declaredMime: string, size: number): void => {
  if (declaredMime !== "image/png" && declaredMime !== "image/jpeg") throw new Error("Alege o imagine PNG sau JPEG.")
  if (size > issuerBrandImageMaxBytes) throw new Error("Imaginea poate avea maximum 256 KiB.")
}

export const validateBrandingFile = (declaredMime: string, size: number, bytes: Uint8Array): RasterMime => {
  validateBrandingFileInfo(declaredMime, size)
  const detectedMime = detectRasterMime(bytes)
  if (detectedMime === null || detectedMime !== declaredMime) throw new Error("Conținutul fișierului nu corespunde unei imagini PNG sau JPEG valide.")
  return detectedMime
}

export const validateBrandingDimensions = (width: number, height: number): void => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width > issuerBrandImageMaxAxis || height > issuerBrandImageMaxAxis || width * height > issuerBrandImageMaxPixels) {
    throw new Error("Imaginea poate avea maximum 2048 px pe axă și 4 megapixeli.")
  }
}

export interface RevisionGuard {
  readonly begin: () => number
  readonly invalidate: () => void
  readonly current: () => number
  readonly isCurrent: (revision: number) => boolean
}

export const createRevisionGuard = (): RevisionGuard => {
  let current = 0
  return {
    begin: () => { current += 1; return current },
    invalidate: () => { current += 1 },
    current: () => current,
    isCurrent: (revision) => revision === current,
  }
}

export const beginBrandImageSelection = (files: RevisionGuard, edits: RevisionGuard): number => {
  edits.invalidate()
  return files.begin()
}
