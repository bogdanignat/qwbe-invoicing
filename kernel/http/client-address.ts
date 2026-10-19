import type { IncomingMessage } from "node:http"

import { normalizedAddress } from "../auth/login-throttle.ts"
import type { TrustedProxies } from "./trusted-proxy.ts"

/**
 * Who the client is, for the login throttle. The socket peer, unless that peer
 * is a trusted proxy: then the client is the right-most `X-Forwarded-For` entry
 * that is not itself a trusted proxy (every hop to its right is ours, so it is
 * the first address nobody could have forged). A client that is not a trusted
 * proxy cannot move its key by sending the header. When every hop is a trusted
 * address, none of them is a client: the left-most is whatever the sender wrote,
 * and inside a trusted range that sender could rotate it on every request, so
 * the key is the proxy itself, as with a missing header.
 *
 * From a trusted proxy, a repeated or malformed header is refused (`invalid`):
 * the proxy is supposed to write exactly one list of addresses, and anything
 * else cannot be read without guessing. A missing header keys on the proxy
 * itself, the shared bucket, which can only be stricter.
 */
export type ClientAddress =
  | { readonly kind: "client"; readonly address: string | undefined }
  | { readonly kind: "invalid" }

const forwardedFor = (rawHeaders: ReadonlyArray<string>): ReadonlyArray<string> => {
  const values: Array<string> = []
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "x-forwarded-for") values.push(rawHeaders[index + 1] ?? "")
  }
  return values
}

export const clientAddress = (request: IncomingMessage, trusted: TrustedProxies): ClientAddress => {
  const peer = request.socket.remoteAddress
  if (peer === undefined || !trusted.trusts(peer)) return { kind: "client", address: peer }
  const values = forwardedFor(request.rawHeaders)
  if (values.length === 0) return { kind: "client", address: peer }
  if (values.length > 1) return { kind: "invalid" }
  const hops = (values[0] ?? "").split(",").map((hop) => normalizedAddress(hop.trim()))
  if (hops.some((hop) => hop === undefined)) return { kind: "invalid" }
  const addresses = hops as ReadonlyArray<string>
  return { kind: "client", address: addresses.findLast((hop) => !trusted.trusts(hop)) ?? peer }
}
