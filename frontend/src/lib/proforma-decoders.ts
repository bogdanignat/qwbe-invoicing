import { decodeDocumentBody } from "./document-snapshot-decoders.ts"
import { decodePage, nullableText, object, text, type Decoder, type Page } from "./model-decoder.ts"
import type { Proforma } from "./proforma-models.ts"

/**
 * Structural decoding, like the fiscal documents it shares a body with.
 *
 * The list and the detail answer the same shape — `ProformaSummary` differs from
 * `Proforma` only in that its issuer carries no branding, and branding is not a
 * field this frontend reads — so one decoder serves both, and a page is that
 * decoder under the shared cursor envelope.
 *
 * Fields the screens never render are not decoded: `actorId`, `organizationId`,
 * `issuedAt` and `source` are asserted by no-one here, exactly as
 * `decodeIssuedInvoice` ignores `actorId` and `draftId`. Everything that is
 * rendered — including the two conversion ids the conversion section decides
 * on — is asserted present and of the declared type, so a contract change fails
 * at this boundary rather than as a button that silently offers the wrong thing.
 */
export const decodeProforma: Decoder<Proforma> = (input) => {
  const value = object(input)
  return {
    ...decodeDocumentBody(value),
    id: text(value.id, "id"),
    dueDate: nullableText(value.dueDate, "dueDate"),
    notes: nullableText(value.notes, "notes"),
    sourceDraftId: nullableText(value.sourceDraftId, "sourceDraftId"),
    convertedInvoiceId: nullableText(value.convertedInvoiceId, "convertedInvoiceId"),
    convertedDraftId: nullableText(value.convertedDraftId, "convertedDraftId"),
  }
}

export const decodeProformaPage: Decoder<Page<Proforma>> = decodePage(decodeProforma)
