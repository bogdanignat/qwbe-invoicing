import { request as httpRequest, type IncomingHttpHeaders } from "node:http"
import { connect } from "node:net"

/**
 * Transport for the edge tests. `fetch` cannot set `Host` and adds headers of its
 * own, so the edge is driven with `node:http` (any Host, nothing added) and,
 * where the bytes on the wire are the subject — duplicate headers, raw targets
 * — with a bare socket.
 */
export interface EdgeReply {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

export interface EdgeCall {
  readonly method?: string
  readonly path: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
}

export const edgeRequest = (port: number, call: EdgeCall): Promise<EdgeReply> => new Promise((resolve, reject) => {
  const outgoing = httpRequest({ host: "127.0.0.1", port, method: call.method ?? "GET", path: call.path,
    headers: call.headers ?? {}, agent: false }, (incoming) => {
    let body = ""
    incoming.setEncoding("utf8")
    incoming.on("data", (chunk: string) => { body += chunk })
    incoming.once("end", () => { resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }) })
    incoming.once("error", reject)
  })
  outgoing.once("error", reject)
  outgoing.end(call.body)
})

const unchunked = (body: string): string => {
  let result = ""
  let rest = body
  for (;;) {
    const lineEnd = rest.indexOf("\r\n")
    const size = Number.parseInt(rest.slice(0, lineEnd), 16)
    if (lineEnd < 0 || !(size > 0)) return result
    result += rest.slice(lineEnd + 2, lineEnd + 2 + size)
    rest = rest.slice(lineEnd + 2 + size + 2)
  }
}

/** Sends `lines` verbatim (CRLF-joined, `Connection: close` and a blank line appended) and reads until the server closes. */
export const rawExchange = (port: number, lines: ReadonlyArray<string>): Promise<EdgeReply> => new Promise((resolve, reject) => {
  const socket = connect(port, "127.0.0.1")
  let received = ""
  socket.setEncoding("latin1")
  socket.on("data", (chunk: string) => { received += chunk })
  socket.once("error", reject)
  socket.once("close", () => {
    const [head = "", ...rest] = received.split("\r\n\r\n")
    const [statusLine = "", ...headerLines] = head.split("\r\n")
    const headers: IncomingHttpHeaders = {}
    for (const line of headerLines) {
      const separator = line.indexOf(":")
      headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim()
    }
    const body = rest.join("\r\n\r\n")
    resolve({ status: Number(statusLine.split(" ")[1] ?? 0), headers,
      body: headers["transfer-encoding"] === "chunked" ? unchunked(body) : body })
  })
  // Written, not ended: a half-closed socket reads to Node as a client that left.
  socket.write(`${[...lines, "Connection: close"].join("\r\n")}\r\n\r\n`)
})
