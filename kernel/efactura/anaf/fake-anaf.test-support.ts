import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import type { Transport } from "../../outbound/send.ts"

/**
 * A fake ANAF on 127.0.0.1, reached only through the transport it hands out.
 * The code under test keeps building the real, constant ANAF URLs
 * (`endpoints.ts`); the transport rewrites `https://api.anaf.ro` and
 * `https://logincert.anaf.ro` to this listener and refuses every other host,
 * so no test can reach ANAF or anything else on the network.
 *
 * Each operation answers like ANAF by default and can be switched to one of
 * the scenarios ANAF (or the road to it) produces: an error inside HTTP 200, a
 * throttle, a request that is read and never answered (an upload that is
 * then listed all the same), a redirect, a body past the limit, an XML answer
 * carrying a DOCTYPE, a refused token, a 500, a body cut short, and (for
 * `stareMesaj`) ANAF's `nok`.
 */
export type FakeOperation = "token" | "revoke" | "validare" | "upload" | "stareMesaj" | "lista" | "descarcare"
export type FakeScenario =
  | "normal" | "error_in_200" | "rate_limited" | "timeout_after_send" | "redirect" | "oversized" | "dtd"
  | "unauthorized" | "server_error" | "malformed" | "rejected"

export interface FakeCall {
  readonly operation: FakeOperation | "unknown"
  readonly method: string
  /** Path and query as ANAF would have received them, e.g. `/test/FCTEL/rest/upload?standard=UBL&cif=1`. */
  readonly path: string
  readonly authorization: string | undefined
  readonly body: Buffer
}

export interface FakeAnaf {
  readonly transport: Transport
  readonly calls: ReadonlyArray<FakeCall>
  readonly answer: (operation: FakeOperation, scenario: FakeScenario) => void
  /** Pages `listaMesajePaginatieFactura`: `perPage` uploads a page, and `totalPages` as ANAF's count when given. */
  readonly paginate: (perPage: number, totalPages?: number) => void
  /** Holds every answer to `operation` for `ms`: a slow ANAF, for races against it. */
  readonly delay: (operation: FakeOperation, ms: number) => void
  readonly close: () => Promise<void>
}

export const FAKE_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x61, 0x6e, 0x61, 0x66])
export const FAKE_RETRY_AFTER = "7"
const OVERSIZED_BYTES = 12 * 1024 * 1024
const ANAF_ORIGINS = new Set(["https://api.anaf.ro", "https://logincert.anaf.ro"])

const operationOf = (pathname: string): FakeOperation | "unknown" => {
  if (pathname === "/anaf-oauth2/v1/token") return "token"
  if (pathname === "/anaf-oauth2/v1/revoke") return "revoke"
  const operation = /^\/(?:test|prod)\/FCTEL\/rest\/(validare\/(?:FACT1|FCN)|upload|stareMesaj|listaMesajePaginatieFactura|descarcare)$/u.exec(pathname)?.[1]
  if (operation === undefined) return "unknown"
  if (operation.startsWith("validare")) return "validare"
  return operation === "listaMesajePaginatieFactura" ? "lista" : operation as FakeOperation
}

const xml = (attributes: string, children = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202610191200" ${attributes}>${children}</header>`
const DTD = `<?xml version="1.0"?><!DOCTYPE header [<!ENTITY x SYSTEM "file:///etc/passwd">]><header ExecutionStatus="0" index_incarcare="&x;"/>`

type Answer = readonly [status: number, contentType: string, body: string | Buffer]
const json = (value: unknown, status = 200): Answer => [status, "application/json", JSON.stringify(value)]
const text = (body: string): Answer => [200, "application/xml", body]

export const startFakeAnaf = async (): Promise<FakeAnaf> => {
  const calls: Array<FakeCall> = []
  const scenarios = new Map<FakeOperation, FakeScenario>()
  const delays = new Map<FakeOperation | "unknown", number>()
  let uploads = 0
  let grants = 0
  /** One page holds every upload unless a test pages the list; `totalPages` overrides the count ANAF reports. */
  let paging: { perPage: number; totalPages: number | undefined } = { perPage: 500, totalPages: undefined }

  const normal = (operation: FakeOperation, url: URL, body: string): Answer => {
    switch (operation) {
      case "token": {
        const form = new URLSearchParams(body)
        if (form.get("code") === "expired" || form.get("refresh_token") === "revoked") return json({ error: "invalid_grant" }, 400)
        grants += 1
        return json({ access_token: `access-${String(grants)}`, refresh_token: `refresh-${String(grants)}`, token_type: "Bearer", expires_in: 7_776_000 })
      }
      case "revoke": return [200, "text/plain", ""]
      case "validare": return json({ stare: "ok", trace_id: "fake-trace" })
      case "upload": {
        uploads += 1
        return text(xml(`ExecutionStatus="0" index_incarcare="${String(5_000_000_000 + uploads)}"`))
      }
      case "stareMesaj": return text(xml(`stare="ok" id_descarcare="${String(3_000_000_000 + Number(url.searchParams.get("id_incarcare") ?? 0) % 1000)}"`))
      case "lista": {
        const page = Number(url.searchParams.get("pagina") ?? 1)
        const all = Array.from({ length: uploads }, (_, index) => ({
          data_creare: "202610191215", cif: url.searchParams.get("cif") ?? "", id_solicitare: String(5_000_000_001 + index),
          detalii: `Factura cu id_incarcare=${String(5_000_000_001 + index)}`, tip: "FACTURA TRIMISA", id: String(3_000_000_001 + index),
        }))
        const pages = paging.totalPages ?? Math.max(1, Math.ceil(all.length / paging.perPage))
        return json({
          mesaje: all.slice((page - 1) * paging.perPage, page * paging.perPage),
          serial: "fake", cui: url.searchParams.get("cif") ?? "", titlu: "Lista Mesaje", numar_total_pagini: pages, index_pagina_curenta: page,
        })
      }
      case "descarcare": return [200, "application/zip", FAKE_ZIP]
    }
  }

  const errorIn200 = (operation: FakeOperation): Answer => {
    switch (operation) {
      case "token": return json({ error: "invalid_grant", error_description: "fake" }, 400)
      case "revoke": return json({ error: "invalid_token" }, 400)
      case "validare": return json({ stare: "nok", Messages: [{ message: "E: [BR-RO-010] fake" }], trace_id: "fake-trace" })
      case "upload": return text(xml(`ExecutionStatus="1"`, `<Errors errorMessage="Fisierul transmis nu este valid."/>`))
      case "stareMesaj": return text(xml("", `<Errors errorMessage="Nu aveti dreptul de inteorgare pentru id_incarcare= 1"/>`))
      case "lista": return json({ eroare: "Nu aveti drept in SPV pentru CIF=12345674", titlu: "Lista Mesaje" })
      case "descarcare": return json({ eroare: "Pentru id=1 nu exista inregistrata nici o factura", titlu: "Descarcare mesaj" })
    }
  }

  const respond = (request: IncomingMessage, response: ServerResponse, body: Buffer) => {
    const url = new URL(request.url ?? "/", "http://fake.invalid")
    const operation = operationOf(url.pathname)
    calls.push({ operation, method: request.method ?? "", path: `${url.pathname}${url.search}`, authorization: request.headers.authorization, body })
    if (operation === "unknown") return response.writeHead(404).end()
    const needsToken = operation !== "token" && operation !== "revoke"
    if (needsToken && !/^Bearer access-\d+$/u.test(request.headers.authorization ?? "")) return response.writeHead(401).end()
    const scenario = scenarios.get(operation) ?? "normal"
    if (scenario === "timeout_after_send") {
      // ANAF took the upload; only its answer is lost. The list shows it, as it would.
      if (operation === "upload") uploads += 1
      return undefined
    }
    if (scenario === "rate_limited") return response.writeHead(429, { "retry-after": FAKE_RETRY_AFTER }).end()
    if (scenario === "redirect") return response.writeHead(302, { location: "https://elsewhere.example/" }).end()
    if (scenario === "dtd") return response.writeHead(200, { "content-type": "application/xml" }).end(DTD)
    if (scenario === "unauthorized") return response.writeHead(401).end()
    if (scenario === "server_error") return response.writeHead(500, { "content-type": "text/html" }).end("<html>Service Unavailable</html>")
    if (scenario === "malformed") return response.writeHead(200, { "content-type": "application/xml" }).end("<header ExecutionStatus=\"0\"")
    if (scenario === "rejected" && operation === "stareMesaj") {
      return response.writeHead(200, { "content-type": "application/xml" }).end(xml(`stare="nok" id_descarcare="3000000999"`))
    }
    if (scenario === "oversized") {
      response.writeHead(200, { "content-type": "application/zip" })
      const chunk = Buffer.alloc(256 * 1024, 0x41)
      for (let sent = 0; sent < OVERSIZED_BYTES; sent += chunk.byteLength) response.write(chunk)
      return response.end()
    }
    const [status, contentType, payload] = scenario === "error_in_200" ? errorIn200(operation) : normal(operation, url, body.toString("utf8"))
    return response.writeHead(status, { "content-type": contentType }).end(payload)
  }

  const server = createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    const delayMs = delays.get(operationOf(new URL(request.url ?? "/", "http://fake.invalid").pathname)) ?? 0
    request.on("end", () => { setTimeout(() => { respond(request, response, Buffer.concat(chunks)) }, delayMs) })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo

  const transport: Transport = async (url, init) => {
    const target = new URL(url)
    if (!ANAF_ORIGINS.has(target.origin)) throw new Error(`the fake ANAF transport refuses ${target.origin}`)
    return fetch(`http://127.0.0.1:${String(port)}${target.pathname}${target.search}`, init)
  }

  return {
    transport,
    calls,
    answer: (operation, scenario) => { scenarios.set(operation, scenario) },
    paginate: (perPage, totalPages) => { paging = { perPage, totalPages } },
    delay: (operation, ms) => { delays.set(operation, ms) },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => { resolve() }))
    },
  }
}
