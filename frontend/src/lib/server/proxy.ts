import * as http from "node:http"
import * as https from "node:https"
import { isIP } from "node:net"
import { Readable } from "node:stream"

import type { ProxyConfig } from "./config.ts"
import { readBoundedRequestBody, RequestBodyTimeout, RequestBodyTooLarge } from "./proxy-body.ts"
import { proxyRequestHeaders, proxyResponseHeaders } from "./proxy-headers.ts"
import { mapProxyPath } from "./proxy-path.ts"

class UpstreamTimeout extends Error {}
class UpstreamRedirect extends Error {}
const redirectStatuses = new Set([300, 301, 302, 303, 305, 307, 308])

const errorResponse = (status: number, error: string, method = "GET"): Response => {
  const body = `${JSON.stringify({ error })}\n`
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  })
}

const noResponseBody = (method: string, status: number): boolean =>
  method === "HEAD" || status === 204 || status === 205 || status === 304

/**
 * The name the upstream certificate is checked under, decided here rather than left
 * to be derived from a header this proxy rewrote.
 *
 * For a hostname it is that hostname. For a literal address it is the empty
 * string, which is a decision and not an omission: RFC 6066 admits no address in
 * SNI, and an address needs no name to be checked against because Node matches it
 * against the certificate's IP entries instead. Left out entirely, Node fills the
 * gap from the outgoing `Host` header — the public origin — and would then judge
 * the upstream certificate under the deployment's public name, which the upstream
 * has no reason to carry: a valid address certificate is rejected, and a
 * certificate for the public name would be accepted from a host that is not it.
 */
const serverName = (upstream: URL): string | undefined => {
  if (upstream.protocol !== "https:") return undefined
  const hostname = upstream.hostname.replace(/^\[|\]$/gu, "")
  return isIP(hostname) === 0 ? hostname : ""
}

const upstreamRequest = (
  request: Request,
  config: ProxyConfig,
  path: string,
  headers: Readonly<Record<string, string>>,
  body: Uint8Array | undefined,
  deadlineAt: number,
): Promise<Response> => new Promise((resolve, reject) => {
  const transport = config.upstreamBase.protocol === "https:" ? https : http
  const upstreamServerName = serverName(config.upstreamBase)
  let receivedHeaders = false
  let settled = false
  let incomingResponse: http.IncomingMessage | undefined
  const options: https.RequestOptions = {
    protocol: config.upstreamBase.protocol,
    hostname: config.upstreamBase.hostname,
    port: config.upstreamBase.port || undefined,
    method: request.method,
    path,
    headers: { ...headers, ...(body === undefined ? {} : { "content-length": String(body.byteLength) }) },
    // The upstream is addressed by its own name or address, while the Host header
    // carries the public origin; `serverName` decides which identity the certificate
    // is checked under so that nothing is left for Node to derive from that header.
    ...(upstreamServerName === undefined ? {} : { servername: upstreamServerName }),
  }
  const cleanup = (): void => {
    clearTimeout(deadline)
    request.signal.removeEventListener("abort", abort)
  }
  const outgoing = transport.request(options, (incoming) => {
    incomingResponse = incoming
    receivedHeaders = true
    const status = incoming.statusCode !== undefined && incoming.statusCode >= 200 && incoming.statusCode <= 599
      ? incoming.statusCode
      : 502
    if (redirectStatuses.has(status)) {
      settled = true
      cleanup()
      incoming.destroy()
      reject(new UpstreamRedirect())
      return
    }
    const checkedHeaders = proxyResponseHeaders(incoming.headers, incoming.rawHeaders, config.frontendOrigin.protocol === "https:")
    if (!checkedHeaders.ok) {
      settled = true
      cleanup()
      incoming.destroy()
      resolve(errorResponse(502, checkedHeaders.error, request.method))
      return
    }
    const responseHeaders = checkedHeaders.headers
    incoming.on("error", cleanup)
    incoming.once("end", cleanup)
    incoming.once("close", cleanup)
    if (noResponseBody(request.method, status)) {
      incoming.resume()
      settled = true
      resolve(new Response(null, { status, headers: responseHeaders }))
      return
    }
    settled = true
    resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }))
  })
  const terminate = (error: Error): void => {
    incomingResponse?.destroy(error)
    outgoing.destroy(error)
  }
  const abort = (): void => { terminate(new Error("request_aborted")) }
  const remaining = deadlineAt - Date.now()
  const deadline = setTimeout(() => { terminate(new UpstreamTimeout()) }, Math.max(0, remaining))
  outgoing.once("error", (error) => {
    cleanup()
    if (receivedHeaders || settled) return
    settled = true
    reject(error)
  })
  if (request.signal.aborted) abort()
  else request.signal.addEventListener("abort", abort, { once: true })
  if (body !== undefined && body.byteLength > 0) outgoing.write(body)
  outgoing.end()
})

export const handleProxyRequest = async (request: Request, config: ProxyConfig): Promise<Response> => {
  const deadlineAt = Date.now() + config.timeoutMs
  const path = mapProxyPath(request.url, config.upstreamBase)
  if (path === undefined) return errorResponse(404, "not_found", request.method)
  const checkedHeaders = proxyRequestHeaders(request, config)
  if (!checkedHeaders.ok) return errorResponse(checkedHeaders.status, checkedHeaders.error, request.method)
  try {
    const body = await readBoundedRequestBody(request, deadlineAt)
    if (Date.now() >= deadlineAt) throw new UpstreamTimeout()
    return await upstreamRequest(request, config, path, checkedHeaders.headers, body, deadlineAt)
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return errorResponse(413, "request_body_too_large", request.method)
    if (error instanceof UpstreamTimeout || error instanceof RequestBodyTimeout) {
      return errorResponse(504, "upstream_timeout", request.method)
    }
    return errorResponse(502, "upstream_unavailable", request.method)
  }
}

export const proxyNotFound = (request: Request): Response => errorResponse(404, "not_found", request.method)
