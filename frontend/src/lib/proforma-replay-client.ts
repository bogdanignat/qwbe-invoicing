import { decodeDraft } from "./draft-decoders.ts"
import { decodeIssuedInvoice } from "./document-snapshot-decoders.ts"
import { encoded } from "./client-paths.ts"
import { object, text } from "./model-decoder.ts"
import { readableWrite } from "./unreadable-answer.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"

/**
 * The proforma writes a stored intent can be sent again through.
 *
 * Only the replay surface lives here. A replay carries the request exactly as
 * it was first sent — an opaque body under the key written down before it left
 * — so it needs no payload type of its own, and the proforma screens that will
 * build those payloads bring their own client. What it does need is the three
 * endpoints a journal record can name: issuing a proforma, and the two
 * conversions, which differ only in whether the server seals an invoice or
 * hands back an editable draft.
 */
export interface ProformaIdentity {
  readonly id: string
}

/** A proforma is only ever identified here: the screen that has to display one reads it back itself. */
export const decodeProformaIdentity = (input: unknown): ProformaIdentity => ({
  id: text(object(input).id, "id"),
})

export interface ProformaReplayClient {
  readonly replayProformaIssuance: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<ProformaIdentity>
  readonly replayInvoiceFromProforma: (csrfToken: string, proformaId: string, body: unknown, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly replayDraftFromProforma: (csrfToken: string, proformaId: string, body: unknown, idempotencyKey: string) => Promise<DraftInvoice>
}

export const createProformaReplayClient = (transport: BrowserTransport): ProformaReplayClient => {
  /**
   * The stored body is opaque and may be missing — the journal accepts a `null`
   * body as it accepts any other — so it is normalised exactly as in
   * `drafts-client.ts`: an absent body is sent as `{}`, never as a literal
   * `null` the server would refuse with a validation error, which would leave
   * the key unresolved instead of replaying it.
   */
  const write = <T>(
    path: string, csrfToken: string, body: unknown, idempotencyKey: string, decode: (value: unknown) => T,
  ): Promise<T> =>
    readableWrite(transport.json(path, { csrfToken, method: "POST", body: body ?? {}, idempotencyKey }).then(decode))
  return {
    replayProformaIssuance: (csrfToken, body, idempotencyKey) =>
      write("/api/proformas", csrfToken, body, idempotencyKey, decodeProformaIdentity),
    replayInvoiceFromProforma: (csrfToken, proformaId, body, idempotencyKey) =>
      write(`/api/proformas/${encoded(proformaId)}/invoice`, csrfToken, body, idempotencyKey, decodeIssuedInvoice),
    replayDraftFromProforma: (csrfToken, proformaId, body, idempotencyKey) =>
      write(`/api/proformas/${encoded(proformaId)}/draft-invoice`, csrfToken, body, idempotencyKey, decodeDraft),
  }
}
