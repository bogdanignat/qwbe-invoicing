import type { IncomingMessage, ServerResponse } from "node:http"

import { untilAborted } from "./edge-deadline.ts"
import { securityHeaders } from "./security-headers.ts"

const maximumBodyBytes = 1_000_000

/**
 * Every answer the listener writes goes through here, so every one of them
 * carries the security headers. A response that has already started (the
 * deadline answered, the client went away) is never written a second time.
 */
export const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void => {
  if (response.headersSent || response.writableEnded || response.destroyed) return
  if (body instanceof Uint8Array) {
    response.writeHead(status, { ...securityHeaders, ...headers })
    response.end(body)
    return
  }
  response.writeHead(status, {
    ...securityHeaders,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  })
  response.end(`${JSON.stringify(body)}\n`)
}

const collectBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Array<Buffer> = []
  let size = 0
  for await (const chunk of request) {
    const value: unknown = chunk
    if (!(typeof value === "string" || value instanceof Uint8Array)) throw new Error("invalid_request_body")
    const bytes = Buffer.from(value)
    size += bytes.length
    if (size > maximumBodyBytes) throw new Error("request_body_too_large")
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** The body, bounded in size and by the request's signal: a slow upload cannot outlive the deadline. */
export const readRawBody = async (request: IncomingMessage, signal: AbortSignal): Promise<string> => {
  if (request.method === "GET" || request.method === "HEAD") return ""
  const declared = Number(request.headers["content-length"] ?? "0")
  if (declared > maximumBodyBytes) throw new Error("request_body_too_large")
  return untilAborted(collectBody(request), signal)
}

/**
 * The handler's `Request`, addressed to the canonical origin (Host is already
 * pinned to it) and carrying the request's signal: the Effect runtime interrupts
 * the handler when the deadline passes or the client goes away.
 */
export const webRequest = (request: IncomingMessage, raw: string, origin: URL, signal: AbortSignal): Request => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item)
  }
  const method = request.method ?? "GET"
  return new Request(`${origin.origin}${request.url ?? "/"}`, {
    method,
    headers,
    signal,
    ...(method === "GET" || method === "HEAD" ? {} : { body: raw.length === 0 ? "{}" : raw }),
  })
}

export const header = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : undefined
