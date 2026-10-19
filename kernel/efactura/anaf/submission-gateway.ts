import { Effect, Redacted } from "effect"

import type { AnafEnvironment } from "../../../cubes/invoicing/efactura/connection/index.ts"
import type { AnafReply } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { send, type BodyDecoding, type SendFailure, type SendReply, type Transport } from "../../outbound/send.ts"
import { ANAF_HTTP, anafApi, type ListWindow } from "./endpoints.ts"

type Reply<D extends BodyDecoding> = Effect.Effect<AnafReply<SendReply<D>["body"]>, SendFailure>

/**
 * The e-Factura calls the dispatcher (and a reconciliation request) makes. The URLs are the constants of
 * `endpoints.ts`; the token goes only into the header. A transport failure is
 * handed back as it is (`not_sent` or `ambiguous`), every answer with its
 * status: judging it is the cube's.
 */
export const createSubmissionGateway = (environment: AnafEnvironment, transport: Transport) => {
  const api = anafApi(environment)
  const call = <D extends BodyDecoding>(decode: D, url: string, token: Redacted.Redacted, init: RequestInit = {}): Reply<D> =>
    send({ transport, timeoutMs: ANAF_HTTP.timeoutMs, maxBodyBytes: ANAF_HTTP.maxBodyBytes, decode }, url, {
      ...init, headers: { authorization: `Bearer ${Redacted.value(token)}`, ...(init.method === "POST" ? { "content-type": "text/plain" } : {}) },
    }).pipe(Effect.map((reply) => ({ status: reply.status, retryAfter: reply.headers.get("retry-after"), body: reply.body })))
  const post = (url: string, token: Redacted.Redacted, xml: Uint8Array) => call("utf8", url, token, { method: "POST", body: xml })
  return {
    validate: (token: Redacted.Redacted, standard: "UBL" | "CN", xml: Uint8Array) =>
      post(api.validate(standard === "UBL" ? "FACT1" : "FCN"), token, xml),
    upload: (token: Redacted.Redacted, standard: "UBL" | "CN", cif: string, xml: Uint8Array) => post(api.upload(standard, cif), token, xml),
    status: (token: Redacted.Redacted, uploadIndex: string) => call("utf8", api.status(uploadIndex), token),
    download: (token: Redacted.Redacted, downloadId: string) => call("bytes", api.download(downloadId), token),
    /** `listaMesajePaginatieFactura`: read-only, asked by a reconciliation request. */
    list: (token: Redacted.Redacted, window: ListWindow) => call("utf8", api.list(window), token),
  }
}

export type SubmissionGateway = ReturnType<typeof createSubmissionGateway>
