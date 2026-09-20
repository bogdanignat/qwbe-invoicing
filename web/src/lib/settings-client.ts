import { Effect } from "effect"
import { apiRequest } from "./api-transport.ts"
import { decodeDocumentSeries, decodeDocumentSeriesList, decodeIssuer, decodeVatCatalogue } from "./models.ts"
import type { CreateDocumentSeriesInput, IssuerInput } from "./invoicing-client-types.ts"

export const settingsClient = {
  getIssuer: () => apiRequest("/api/issuer", decodeIssuer).pipe(
    Effect.catchAll((failure) => failure.status === 404
      ? Effect.succeed(null)
      : Effect.fail(failure)),
  ),
  saveIssuer: (body: IssuerInput) => apiRequest("/api/issuer", decodeIssuer, { method: "PUT", body }),
  getVatCatalogue: () => apiRequest("/api/vat-regimes", decodeVatCatalogue),
  listDocumentSeries: () => apiRequest("/api/document-series", decodeDocumentSeriesList),
  createDocumentSeries: (body: CreateDocumentSeriesInput) =>
    apiRequest("/api/document-series", decodeDocumentSeries, { method: "POST", body }),
} as const
