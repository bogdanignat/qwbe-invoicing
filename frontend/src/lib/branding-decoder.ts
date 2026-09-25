import { integer, nullableText, object, text, type Decoder } from "./model-decoder.ts"
import type { IssuerBranding, IssuerBrandingImage } from "./draft-models.ts"

/**
 * The branding half of the issuer answer, decoded on its own.
 *
 * It lives apart from `authoring-reference-decoders.ts` because the issuer
 * decoder there is already at its size budget, and because the shape is
 * asymmetric: what the browser sends is `{ dataBase64 }`, what the backend
 * answers is the re-encoded `{ pngBase64, width, height }`. Only the answer is
 * decoded — the request is built by `issuer-payload.ts`.
 */
const decodeIssuerBrandingImage: Decoder<IssuerBrandingImage> = (input) => {
  const value = object(input)
  return {
    pngBase64: text(value.pngBase64, "pngBase64"),
    width: integer(value.width, "width"),
    height: integer(value.height, "height"),
  }
}

export const decodeIssuerBranding: Decoder<IssuerBranding | null> = (input) => {
  // The contract always sends the field; "no brand" is `null`, not an absence.
  // Tolerating a missing one would read as `savedBrandingImage(null)`, and the
  // next save would send `branding: null` and erase a stored logo in silence.
  if (input === undefined) throw new Error("invalid branding")
  if (input === null) return null
  const value = object(input)
  return {
    text: nullableText(value.text, "branding.text"),
    image: value.image === null ? null : decodeIssuerBrandingImage(value.image),
  }
}
