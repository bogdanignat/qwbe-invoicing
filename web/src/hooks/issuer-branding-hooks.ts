import { useRef, useState } from "react"
import {
  beginBrandImageSelection, brandingDraftFromSaved, changeBrandImage, changeBrandText,
  createRevisionGuard, removeBrandImage, removeBranding, validateBrandingDimensions,
  validateBrandingFile, validateBrandingFileInfo,
  type BrandingDraft, type RasterMime, type RevisionGuard,
} from "../lib/issuer-branding.ts"
import type { IssuerBranding } from "../lib/models.ts"

const decodeImageDimensions = async (
  blob: Blob,
): Promise<{ readonly width: number; readonly height: number }> => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob)
    try {
      return { width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  }
  return new Promise((resolve, reject) => {
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

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export const useIssuerBranding = (
  saved: IssuerBranding | null,
  editGuard: { readonly current: RevisionGuard },
  notify: (message: string) => void,
) => {
  const [override, setOverride] = useState<BrandingDraft | undefined>()
  const [error, setError] = useState<Error | null>(null)
  const [imageError, setImageError] = useState<Error | null>(null)
  const [pending, setPending] = useState(false)
  const fileGuard = useRef(createRevisionGuard())
  const branding = override ?? brandingDraftFromSaved(saved)

  const changeText = (text: string): void => {
    editGuard.current.invalidate()
    setOverride((current) => changeBrandText(current ?? brandingDraftFromSaved(saved), text))
    setError(null)
  }

  const selectImage = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    const selection = beginBrandImageSelection(fileGuard.current, editGuard.current)
    setPending(true)
    setImageError(null)
    try {
      validateBrandingFileInfo(file.type, file.size)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const mime: RasterMime = validateBrandingFile(
        file.type,
        Math.max(file.size, bytes.byteLength),
        bytes,
      )
      const dimensions = await decodeImageDimensions(new Blob([bytes], { type: mime }))
      validateBrandingDimensions(dimensions.width, dimensions.height)
      if (!fileGuard.current.isCurrent(selection)) return
      const dataBase64 = bytesToBase64(bytes)
      editGuard.current.invalidate()
      setOverride((current) => changeBrandImage(
        current ?? brandingDraftFromSaved(saved),
        {
          dataBase64,
          previewUrl: `data:${mime};base64,${dataBase64}`,
          width: dimensions.width,
          height: dimensions.height,
        },
      ))
    } catch (cause) {
      if (fileGuard.current.isCurrent(selection)) {
        const imageIssue = cause instanceof Error
          ? cause
          : new Error("Imaginea nu a putut fi citită.")
        setImageError(imageIssue)
        notify(`Sigla nu a fost încărcată: ${imageIssue.message}`)
      }
    } finally {
      if (fileGuard.current.isCurrent(selection)) setPending(false)
    }
  }

  const removeImage = (): void => {
    fileGuard.current.invalidate()
    editGuard.current.invalidate()
    setPending(false)
    setError(null)
    setImageError(null)
    setOverride((current) => removeBrandImage(current ?? brandingDraftFromSaved(saved)))
  }
  const removeAll = (): void => {
    fileGuard.current.invalidate()
    editGuard.current.invalidate()
    setPending(false)
    setError(null)
    setImageError(null)
    setOverride(removeBranding())
  }
  const resetBranding = (): void => {
    fileGuard.current.invalidate()
    setOverride(undefined)
    setError(null)
    setImageError(null)
  }

  return {
    brandingView: {
      ...branding,
      error,
      imageError,
      pending,
      changeText,
      selectImage,
      removeImage,
      removeAll,
      discardRejectedImage: () => { setImageError(null) },
    },
    setBrandingError: setError,
    resetBranding,
  }
}
