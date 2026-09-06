import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { apiDocsResponse } from "./api-docs.ts"
import { createApiHandler } from "./api.ts"
import { createRequestAuthenticator } from "./auth.ts"
import { createBrowserSession } from "./browser-session.ts"
import type { RuntimeConfig } from "./config.ts"
import { databaseReady } from "./migrations.ts"
import { cachedReadiness, readinessIntervalMs } from "./readiness.ts"
import { staticUiResponse } from "./static-ui.ts"

interface HttpResponse {
  readonly status: number
  readonly body: Readonly<Record<string, string>>
}

const maximumBodyBytes = 1_000_000

export const route = (method: string | undefined, url: string | undefined, ready: boolean): HttpResponse => {
  if (method !== "GET") return { status: 405, body: { status: "method_not_allowed" } }
  if (url === "/health/live") return { status: 200, body: { status: "live" } }
  if (url === "/health/ready") {
    return ready
      ? { status: 200, body: { status: "ready" } }
      : { status: 503, body: { status: "not_ready" } }
  }
  if (url === "/") return { status: 200, body: { application: "QWBE Invoicing", status: "invoice_core" } }
  return { status: 404, body: { status: "not_found" } }
}

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
) => {
  if (body instanceof Uint8Array) {
    response.writeHead(status, { "x-content-type-options": "nosniff", ...headers })
    response.end(body)
    return
  }
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  })
  response.end(`${JSON.stringify(body)}\n`)
}

// The body is read here, bounded and syntax-checked, so the API handler receives complete JSON
// and the size and syntax failures keep their own status codes.
const readRawBody = async (request: IncomingMessage): Promise<string> => {
  if (request.method === "GET" || request.method === "HEAD") return ""
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
  const raw = Buffer.concat(chunks).toString("utf8")
  if (raw.length > 0) JSON.parse(raw)
  return raw
}

const webRequest = (request: IncomingMessage, raw: string): Request => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item)
  }
  const method = request.method ?? "GET"
  return new Request(`http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`, {
    method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: raw.length === 0 ? "{}" : raw }),
  })
}

const header = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : undefined

export const startServer = (
  config: RuntimeConfig,
  isReady: () => boolean = cachedReadiness(() => databaseReady(config.dataDirectory), readinessIntervalMs),
  renderApiDocs: () => Promise<Awaited<ReturnType<typeof apiDocsResponse>>> = apiDocsResponse,
): Server => {
  const authenticate = createRequestAuthenticator(config)
  const browserSession = createBrowserSession(config)
  const api = createApiHandler({ authenticate, dataDirectory: config.dataDirectory, browserSession })
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url === undefined ? undefined : new URL(request.url, "http://localhost").pathname
      if (path === "/api" && request.method === "GET") {
        if (!isReady()) {
          send(response, 503, { error: "not_ready" })
          return
        }
        const session = browserSession.resume(header(request.headers.cookie))
        if (session.kind === "unauthorized") {
          send(response, 401, { error: "AuthenticationRequired" }, { "set-cookie": browserSession.clearCookie })
          return
        }
        try {
          const docs = await renderApiDocs()
          send(response, docs.status, docs.body, docs.headers)
        } catch {
          send(response, 500, { error: "internal_failure" })
        }
        return
      }
      if (path?.startsWith("/api/") === true) {
        if (!isReady()) {
          send(response, 503, { error: "not_ready" })
          return
        }
        try {
          const result = await api.handle(webRequest(request, await readRawBody(request)))
          const body = Buffer.from(await result.arrayBuffer())
          const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff" }
          result.headers.forEach((value, name) => { if (name !== "set-cookie") headers[name] = value })
          const setCookie = result.headers.getSetCookie()
          // A rejected cookie is cleared so the browser stops presenting it; bearer callers keep theirs.
          if (result.status === 401 && header(request.headers.authorization) === undefined
            && header(request.headers.cookie) !== undefined && setCookie.length === 0) setCookie.push(browserSession.clearCookie)
          response.writeHead(result.status, { ...headers, ...(setCookie.length > 0 ? { "set-cookie": setCookie } : {}) })
          response.end(body)
        } catch (error) {
          if (error instanceof Error && error.message === "request_body_too_large") {
            send(response, 413, { error: "request_body_too_large" })
          } else if (error instanceof SyntaxError) {
            send(response, 400, { error: "invalid_json" })
          } else {
            send(response, 500, { error: "internal_failure" })
          }
        }
        return
      }
      const ui = staticUiResponse(request.method, path)
      if (ui !== undefined) {
        send(response, ui.status, ui.body, ui.headers)
        return
      }
      const result = route(request.method, path, isReady())
      send(response, result.status, result.body)
    })()
  })
  server.listen(config.port, config.host, () => {
    console.log(`QWBE Invoicing listening on http://${config.host}:${String(config.port)}`)
  })
  return server
}
