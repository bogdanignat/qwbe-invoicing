import { Either, ParseResult, Schema } from "effect"

import {
  ValidationFailure,
  type AddDraftLineInput,
  type AuthoringDocumentInput,
  type AuthoringProformaInput,
  type ConfigureDocumentSeriesInput,
  type ConfigureIssuerInput,
  type CreateCustomerInput,
  type CreateDraftInput,
  type DocumentSource,
  type PageRequest,
  type ProductPresetInput,
  type UpdateDraftInput,
  type UpdateDraftLineInput,
} from "../cube/invoicing/index.ts"
import * as S from "./http-schemas.ts"

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A => {
  const result = Schema.decodeUnknownEither(schema, { errors: "all" })(value)
  if (Either.isRight(result)) return result.right
  const issues = ParseResult.ArrayFormatter.formatErrorSync(result.left).map(({ path, message }) =>
    path.length === 0 ? message : `${path.join(".")}: ${message}`)
  throw new ValidationFailure({ issues })
}

export const issuerInput = (value: unknown): ConfigureIssuerInput => decode(S.IssuerInput, value)
export const customerInput = (value: unknown): CreateCustomerInput => decode(S.CustomerInput, value)
export const productPresetInput = (value: unknown): ProductPresetInput => decode(S.ProductPresetInput, value)
export const documentSeriesInput = (value: unknown): ConfigureDocumentSeriesInput => decode(S.DocumentSeriesInput, value)
export const draftInput = (value: unknown): CreateDraftInput => decode(S.DraftInput, value)
export const updateDraftInput = (draftId: string, value: unknown): UpdateDraftInput => ({
  ...decode(S.UpdateDraftInput, value), draftId,
})
export const lineInput = (draftId: string, value: unknown): AddDraftLineInput => ({
  ...decode(S.DraftLineInput, value), draftId,
})
export const updateLineInput = (draftId: string, lineId: string, value: unknown): UpdateDraftLineInput => ({
  ...decode(S.DraftLineInput, value), draftId, lineId,
})
export const paymentInput = (invoiceId: string, value: unknown) => ({ ...decode(S.PaymentInput, value), invoiceId })
export const reversalInput = (invoiceId: string, paymentId: string, value: unknown) => ({
  ...decode(S.ReversalInput, value), invoiceId, paymentId,
})
export const correctionInput = (originalInvoiceId: string, value: unknown) => ({
  ...decode(S.CorrectionInput, value), originalInvoiceId,
})
export const issueProformaInput = (draftId: string, value: unknown) => ({ ...decode(S.IssueProformaInput, value), draftId })
export const authoringInvoiceInput = (value: unknown): AuthoringDocumentInput => decode(S.AuthoringDocumentInput, value)
export const authoringProformaInput = (value: unknown): AuthoringProformaInput => decode(S.AuthoringProformaInput, value)
export const emptyInput = (value: unknown): Record<string, never> => decode(S.EmptyInput, value)

export const pageRequest = (params: URLSearchParams): PageRequest | undefined => {
  // URLSearchParams multiplicity is transport-level; value rules belong to Schema.
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) {
    throw new ValidationFailure({ issues: ["limit and cursor must be supplied at most once"] })
  }
  const page = decode(S.PageQuery, Object.fromEntries(params))
  return page.limit === undefined && page.cursor === undefined ? undefined : page
}
export const sourceFilter = (params: URLSearchParams): DocumentSource | undefined => {
  if (["sourceApp", "sourceKind", "sourceId"].some((key) => params.getAll(key).length > 1)) {
    throw new ValidationFailure({ issues: ["sourceApp, sourceKind, and sourceId must be supplied exactly once and together"] })
  }
  const source = decode(S.SourceFilter, Object.fromEntries(params))
  return source.sourceApp === undefined ? undefined : { app: source.sourceApp, kind: source.sourceKind, id: source.sourceId }
}
