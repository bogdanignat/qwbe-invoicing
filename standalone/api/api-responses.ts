import { createHash } from "node:crypto"

import { HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"

import type { EFacturaDocument } from "../../cube/efactura/index.ts"
import { EFacturaContractViolation, renderEFacturaXml } from "../../cube/efactura/index.ts"
import { ValidationFailure } from "../../cube/invoicing/index.ts"

export const pdfResponse = (kind: "invoice" | "proforma", id: string, bytes: Uint8Array, sha256: string) => {
  const filenameId = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || kind
  return HttpServerResponse.uint8Array(bytes, { contentType: "application/pdf", headers: {
    "content-disposition": `attachment; filename="${kind}-${filenameId}.pdf"`, "x-content-type-options": "nosniff",
    etag: `"sha256-${sha256}"`,
  } })
}

export const efacturaXml = (
  build: () => EFacturaDocument,
): Effect.Effect<HttpServerResponse.HttpServerResponse, ValidationFailure> => Effect.suspend(() => {
  try {
    const document = build()
    const bytes = new TextEncoder().encode(renderEFacturaXml(document))
    const filename = document.id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 100) || "efactura"
    return Effect.succeed(HttpServerResponse.uint8Array(bytes, { contentType: "application/xml", headers: {
      "content-disposition": `attachment; filename="${filename}.xml"`, "x-content-type-options": "nosniff",
      etag: `"sha256-${createHash("sha256").update(bytes).digest("hex")}"`,
    } }))
  } catch (error) {
    if (error instanceof EFacturaContractViolation) return Effect.fail(new ValidationFailure({ issues: error.issues }))
    throw error
  }
})
