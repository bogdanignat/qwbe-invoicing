import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { handleApiRequest } from "./api.ts"
import { createRequestAuthenticator } from "./auth.ts"
import type { RuntimeConfig } from "./config.ts"
import { databaseReady } from "./migrations.ts"
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

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  if (request.method === "GET") return undefined
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
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

export const startServer = (
  config: RuntimeConfig,
  isReady: () => boolean = () => databaseReady(config.dataDirectory),
): Server => {
  const authenticate = createRequestAuthenticator(config)
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url === undefined ? undefined : new URL(request.url, "http://localhost").pathname
      if (path?.startsWith("/api/") === true) {
        if (!isReady()) {
          send(response, 503, { error: "not_ready" })
          return
        }
        try {
          const result = await handleApiRequest({
            method: request.method ?? "GET",
            url: path,
            authorization: request.headers.authorization,
            body: await readBody(request),
          }, { authenticate, dataDirectory: config.dataDirectory })
          send(response, result.status, result.body, result.headers)
        } catch (error) {
          const status = error instanceof Error && error.message === "request_body_too_large" ? 413 : 400
          send(response, status, { error: status === 413 ? "request_body_too_large" : "invalid_json" })
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
