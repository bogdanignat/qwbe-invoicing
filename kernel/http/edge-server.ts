import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"

import type { RuntimeConfig } from "../config.ts"
import { requestDeadlineMs } from "./edge-deadline.ts"
import type { EdgePolicy } from "./edge-guard.ts"
import { answerClientError, transportSecurityHeaders } from "./security-headers.ts"

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
 * HSTS is set on every response before the request listener runs, so each
 * `writeHead` after it carries the header too.
 */
export const hardenTransport = (server: Server, config: RuntimeConfig): void => {
  server.headersTimeout = 10_000
  server.requestTimeout = requestDeadlineMs + 5_000
  const transport = transportSecurityHeaders(config.publicOrigin)
  server.on("clientError", (error: Error & { readonly code?: string }, socket: Duplex) => { answerClientError(error, socket, transport) })
  server.prependListener("request", (_request, response) => {
    for (const [name, value] of Object.entries(transport)) response.setHeader(name, value)
  })
}
