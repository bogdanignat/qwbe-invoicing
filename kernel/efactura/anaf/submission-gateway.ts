import { Effect, Redacted } from "effect"

import type { AnafEnvironment } from "../../../cubes/invoicing/efactura/connection/index.ts"
import type { AnafReply } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { send, type BodyDecoding, type SendFailure, type SendReply, type Transport } from "../../outbound/send.ts"
import { ANAF_HTTP, anafApi, type ListWindow } from "./endpoints.ts"

type Reply<D extends BodyDecoding> = Effect.Effect<AnafReply<SendReply<D>["body"]>, SendFailure>

/**
 * The e-Factura calls the dispatcher (and a reconciliation request) makes. The URLs are the constants of
 * `endpoints.ts`; the token goes only into the header, and never to `validare`. A transport failure is
 * handed back as it is (`not_sent` or `ambiguous`), every answer with its
 * status: judging it is the cube's.
 */
export const createSubmissionGateway = (environment: AnafEnvironment, transport: Transport) => {
  const api = anafApi(environment)
  const request = <D extends BodyDecoding>(decode: D, url: string, headers: Readonly<Record<string, string>>, xml?: Uint8Array): Reply<D> =>
    send({ transport, timeoutMs: ANAF_HTTP.timeoutMs, maxBodyBytes: ANAF_HTTP.maxBodyBytes, decode }, url,
      xml === undefined ? { headers } : { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: xml },
    ).pipe(Effect.map((reply) => ({ status: reply.status, retryAfter: reply.headers.get("retry-after"), body: reply.body })))
  const call = <D extends BodyDecoding>(decode: D, url: string, token: Redacted.Redacted, xml?: Uint8Array): Reply<D> =>
    request(decode, url, { authorization: `Bearer ${Redacted.value(token)}` }, xml)
  return {
    /** The public validator: no token goes to it (see `endpoints.ts`). */
    validate: (standard: "UBL" | "CN", xml: Uint8Array) => request("utf8", api.validate(standard === "UBL" ? "FACT1" : "FCN"), {}, xml),
    upload: (token: Redacted.Redacted, standard: "UBL" | "CN", cif: string, xml: Uint8Array) => call("utf8", api.upload(standard, cif), token, xml),
    status: (token: Redacted.Redacted, uploadIndex: string) => call("utf8", api.status(uploadIndex), token),
    download: (token: Redacted.Redacted, downloadId: string) => call("bytes", api.download(downloadId), token),
    /** `listaMesajePaginatieFactura`: read-only, asked by a reconciliation request. */
    list: (token: Redacted.Redacted, window: ListWindow) => call("utf8", api.list(window), token),
  }
}

export type SubmissionGateway = ReturnType<typeof createSubmissionGateway>
