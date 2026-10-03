import { decodeDraft } from "./draft-decoders.ts"
import { decodeIssuedInvoice } from "./document-snapshot-decoders.ts"
import { decodeProforma, decodeProformaPage } from "./proforma-decoders.ts"
import { encoded, paged } from "./client-paths.ts"
import { readableWrite } from "./unreadable-answer.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import type { Page, PageRequest } from "./model-decoder.ts"
import type { AuthoringProformaInput, ConvertProformaInput, Proforma } from "./proforma-models.ts"

/**
 * The proforma endpoints the screens author and read through.
 *
 * `proforma-replay-client.ts` covers the same three writes with an opaque body,
 * for resending a stored intent; this is the typed first send. They are separate
 * on purpose: a replay must sew the exact bytes that were written down before
 * the first attempt left, never a payload rebuilt from the current form, so it
 * cannot be expressed as "the same call with a typed body".
 *
 * Every write carries the idempotency key the server requires for proformas —
 * `idempotency-key` is mandatory on all three, not optional as it is on the
 * draft header writes — and passes through `readableWrite`, so an answer that
 * arrived but could not be decoded stays an unknown outcome rather than a
 * failure the recovery journal would clear.
 */
export interface ProformasClient {
  readonly listProformas: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<Proforma>>
  readonly getProforma: (id: string, signal: AbortSignal) => Promise<Proforma>
  readonly createProforma: (csrfToken: string, body: AuthoringProformaInput, idempotencyKey: string) => Promise<Proforma>
  readonly convertToInvoice: (csrfToken: string, id: string, body: ConvertProformaInput, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly convertToDraft: (csrfToken: string, id: string, body: ConvertProformaInput, idempotencyKey: string) => Promise<DraftInvoice>
  readonly downloadProformaPdf: (id: string, csrfToken: string) => Promise<Blob>
}

export const createProformasClient = (transport: BrowserTransport): ProformasClient => {
  const write = <T>(
    path: string, csrfToken: string, body: unknown, idempotencyKey: string, decode: (value: unknown) => T,
  ): Promise<T> =>
    readableWrite(transport.json(path, { csrfToken, method: "POST", body, idempotencyKey }).then(decode))
  return {
    listProformas: async (page, signal) =>
      decodeProformaPage(await transport.json(paged("/api/proformas", page), { signal })),
    getProforma: async (id, signal) =>
      decodeProforma(await transport.json(`/api/proformas/${encoded(id)}`, { signal })),
    createProforma: (csrfToken, body, idempotencyKey) =>
      write("/api/proformas", csrfToken, body, idempotencyKey, decodeProforma),
    convertToInvoice: (csrfToken, id, body, idempotencyKey) =>
      write(`/api/proformas/${encoded(id)}/invoice`, csrfToken, body, idempotencyKey, decodeIssuedInvoice),
    convertToDraft: (csrfToken, id, body, idempotencyKey) =>
      write(`/api/proformas/${encoded(id)}/draft-invoice`, csrfToken, body, idempotencyKey, decodeDraft),
    /**
     * A proforma PDF is rendered before it can be fetched, exactly as an invoice
     * one is: the render is a mutation and needs the session's CSRF token, the
     * byte fetch that follows is a plain read. There is no e-Factura companion —
     * a proforma is not a fiscal document and the backend exposes no XML for it,
     * so this client offers none rather than a button that would `404`.
     */
    downloadProformaPdf: async (id, csrfToken) => {
      await transport.json(`/api/proformas/${encoded(id)}/pdf`, { method: "POST", body: {}, csrfToken })
      return transport.binary(`/api/proformas/${encoded(id)}/pdf`, { accept: "application/pdf" })
    },
  }
}
