import { createServer, type Server } from "node:http"

import type { RuntimeConfig } from "./config.ts"
import { databaseReady } from "./migrations.ts"

interface HttpResponse {
  readonly status: number
  readonly body: Readonly<Record<string, string>>
}

export const route = (method: string | undefined, url: string | undefined, ready: boolean): HttpResponse => {
  if (method !== "GET") return { status: 405, body: { status: "method_not_allowed" } }
  if (url === "/health/live") return { status: 200, body: { status: "live" } }
  if (url === "/health/ready") {
    return ready
      ? { status: 200, body: { status: "ready" } }
      : { status: 503, body: { status: "not_ready" } }
  }
  if (url === "/") return { status: 200, body: { application: "QWBE Invoicing", status: "foundation" } }
  return { status: 404, body: { status: "not_found" } }
}

export const startServer = (
  config: RuntimeConfig,
  isReady: () => boolean = () => databaseReady(config.dataDirectory),
): Server => {
  const server = createServer((request, response) => {
    const result = route(request.method, request.url, isReady())
    response.writeHead(result.status, { "content-type": "application/json; charset=utf-8" })
    response.end(`${JSON.stringify(result.body)}\n`)
  })
  server.listen(config.port, config.host, () => {
    console.log(`QWBE Invoicing listening on http://${config.host}:${String(config.port)}`)
  })
  return server
}
