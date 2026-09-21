import * as http from "node:http"
import * as https from "node:https"
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

const upstreamRequest = (
  request: Request,
  config: ProxyConfig,
  path: string,
  headers: Readonly<Record<string, string>>,
  body: Uint8Array | undefined,
  deadlineAt: number,
): Promise<Response> => new Promise((resolve, reject) => {
  const transport = config.upstreamBase.protocol === "https:" ? https : http
  let receivedHeaders = false
  let settled = false
  let incomingResponse: http.IncomingMessage | undefined
  const options: http.RequestOptions = {
    protocol: config.upstreamBase.protocol,
    hostname: config.upstreamBase.hostname,
    port: config.upstreamBase.port || undefined,
    method: request.method,
    path,
    headers: { ...headers, ...(body === undefined ? {} : { "content-length": String(body.byteLength) }) },
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
    const responseHeaders = proxyResponseHeaders(incoming.headers, incoming.rawHeaders, config.frontendOrigin.protocol === "https:")
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
