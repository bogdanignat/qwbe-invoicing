import type { Server } from "node:http"
import type { AddressInfo } from "node:net"

import type { RuntimeConfig } from "../config.ts"
import { requestDeadlineMs } from "./edge-deadline.ts"
import type { EdgePolicy } from "./edge-guard.ts"
import { answerClientError } from "./security-headers.ts"

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"])

/**
 * Refuses, before anything listens, a server that would have no canonical
 * origin. In production `PUBLIC_ORIGIN` is required. Outside production it may
 * be left out only on a loopback address: the origin is then the address the
 * server listens on (`http://127.0.0.1:<port>`), which is still pinned. A
 * development server on `0.0.0.0` names its origin explicitly.
 */
export const assertServableOrigin = (config: RuntimeConfig): void => {
  if (config.publicOrigin !== undefined) return
  if (config.nodeEnvironment === "production") throw new Error("PUBLIC_ORIGIN is required to serve in production")
  if (!loopbackHosts.has(config.host)) throw new Error("PUBLIC_ORIGIN is required unless HOST is a loopback address")
}

export const edgePolicyFor = (config: RuntimeConfig, address: AddressInfo | string | null): EdgePolicy => {
  const listening = typeof address === "object" && address !== null ? address.port : config.port
  const host = config.host.includes(":") ? `[${config.host}]` : config.host
  return { origin: new URL(config.publicOrigin ?? `http://${host}:${String(listening)}`), bearerApi: config.bearerApi }
}

/**
 * Transport bounds under the request deadline: headers within 10 s, the whole
 * request within the deadline plus a margin (so the listener's 504 answers
 * first), and Node's own parse/timeout answers with the security headers.
 */
export const hardenTransport = (server: Server): void => {
  server.headersTimeout = 10_000
  server.requestTimeout = requestDeadlineMs + 5_000
  server.on("clientError", answerClientError)
}
