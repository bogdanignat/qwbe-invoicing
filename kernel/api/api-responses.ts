import { createHash } from "node:crypto"

import { HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"

import type { EFacturaDocument } from "../../cubes/invoicing/efactura/index.ts"
import type { DocumentKind } from "../../cubes/invoicing/documents/index.ts"
import { EFacturaContractViolation, renderEFacturaXml } from "../../cubes/invoicing/efactura/index.ts"
import { ValidationFailure } from "../../cubes/invoicing/index.ts"

/** An id made safe for `content-disposition`: letters, digits, `_` and `-`, at most 100, never empty. */
export const safeFilename = (id: string, fallback: string): string => id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 100) || fallback

export const pdfResponse = (kind: DocumentKind, id: string, bytes: Uint8Array, sha256: string) =>
  HttpServerResponse.uint8Array(bytes, { contentType: "application/pdf", headers: {
    "content-disposition": `attachment; filename="${kind}-${safeFilename(id, kind)}.pdf"`, "x-content-type-options": "nosniff",
    etag: `"sha256-${sha256}"`,
  } })

/** The UBL bytes of a document, or the list of reasons the mapping refuses it. */
export const renderEFactura = (
  build: () => EFacturaDocument,
): Effect.Effect<{ readonly document: EFacturaDocument; readonly bytes: Uint8Array }, ValidationFailure> => Effect.suspend(() => {
  try {
    const document = build()
    return Effect.succeed({ document, bytes: new TextEncoder().encode(renderEFacturaXml(document)) })
  } catch (error) {
    if (error instanceof EFacturaContractViolation) return Effect.fail(new ValidationFailure({ issues: error.issues }))
    throw error
  }
})

/** Bytes to download as they are: an XML, an ANAF archive. */
export const attachment = (bytes: Uint8Array, contentType: string, filename: string) => HttpServerResponse.uint8Array(bytes, {
  contentType, headers: {
    "content-disposition": `attachment; filename="${filename}"`, "x-content-type-options": "nosniff",
    etag: `"sha256-${createHash("sha256").update(bytes).digest("hex")}"`,
  },
})

export const efacturaXml = (
  build: () => EFacturaDocument,
): Effect.Effect<HttpServerResponse.HttpServerResponse, ValidationFailure> => Effect.map(renderEFactura(build), ({ document, bytes }) =>
  attachment(bytes, "application/xml", `${safeFilename(document.id, "efactura")}.xml`))
