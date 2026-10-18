import type { IncomingMessage, ServerResponse } from "node:http"

const maximumBodyBytes = 1_000_000

export const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void => {
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

export const readRawBody = async (request: IncomingMessage): Promise<string> => {
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
  return Buffer.concat(chunks).toString("utf8")
}

export const webRequest = (request: IncomingMessage, raw: string): Request => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item)
  }
  const method = request.method ?? "GET"
  return new Request(`http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: raw.length === 0 ? "{}" : raw }),
  })
}

export const header = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : undefined
