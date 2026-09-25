import { decodeDocumentSeries, decodeIssuer } from "./authoring-reference-decoders.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { Address, DocumentSeries, DocumentType, Issuer, NonVatBasis } from "./draft-models.ts"

/**
 * The two settings writes: the issuer profile and one new document series.
 *
 * They are separate from `registry-client.ts` only because they are a different
 * screen's writes, and separate from `authoring-reference-client.ts` for the
 * reason that client states: an authoring session reads the issuer and must not
 * be able to rewrite it through the same object.
 *
 * Both carry CSRF and no idempotency key, like the rest of the master data
 * (`standalone/api/http-endpoints-master-data.ts:11-14`): the issuer is a profile
 * that is replaced whole, and a series is idempotent by conflict — a second
 * identical `POST` answers `document_series_exists`, not a duplicate.
 *
 * The issuer `PUT` replaces the profile, so every field is always sent. What
 * cannot be sent is history: `vatConfigurations` and `currentVat` are answers,
 * and `vatChange` is the only way to move the regime.
 */
export type VatChange =
  | { readonly registered: true; readonly effectiveFrom: string; readonly nonVatBasis?: never }
  | { readonly registered: false; readonly effectiveFrom: string; readonly nonVatBasis: NonVatBasis }

/** `null` means "no branding"; an object must carry text, an image, or both. */
export interface IssuerBrandingInput {
  readonly text: string | null
  readonly image: { readonly dataBase64: string } | null
}

export interface IssuerInput {
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: Address
  readonly legalForm: "srl" | "pfa"
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
  readonly defaultCurrency: "RON"
  readonly defaultPaymentTermDays: number
  readonly vatChange: VatChange
  readonly branding: IssuerBrandingInput | null
}

export interface DocumentSeriesInput {
  readonly documentType: DocumentType
  readonly series: string
}

export interface SettingsClient {
  readonly saveIssuer: (csrfToken: string, body: IssuerInput) => Promise<Issuer>
  readonly createDocumentSeries: (csrfToken: string, body: DocumentSeriesInput) => Promise<DocumentSeries>
}

export const createSettingsClient = (transport: BrowserTransport): SettingsClient => ({
  saveIssuer: async (csrfToken, body) =>
    decodeIssuer(await transport.json("/api/issuer", { csrfToken, method: "PUT", body })),
  createDocumentSeries: async (csrfToken, body) =>
    decodeDocumentSeries(await transport.json("/api/document-series", { csrfToken, method: "POST", body })),
})
