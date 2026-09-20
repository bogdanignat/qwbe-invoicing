import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { Effect } from "effect"

import { DocumentRenderingFailure, type InvoiceRenderer } from "../../cube/invoicing/documents/index.ts"
import { renderPdf } from "./pdf-document.ts"

export { documentDateLine, formatAmount, formatRate, issuerLegalLines, partyAddressLines, partyIdentifierLine } from "./pdf-format.ts"

export const invoiceTemplateVersion = "invoice-v9"
export const proformaTemplateVersion = "proforma-v8"

const regularFontPath = fileURLToPath(new URL("./assets/fonts/DejaVuSans.ttf", import.meta.url))
const boldFontPath = fileURLToPath(new URL("./assets/fonts/DejaVuSans-Bold.ttf", import.meta.url))

export const createPdfRenderer = (
  paths: { readonly regular?: string; readonly bold?: string } = {},
): InvoiceRenderer => {
  const fonts = Promise.all([
    readFile(paths.regular ?? regularFontPath),
    readFile(paths.bold ?? boldFontPath),
  ]).then(([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }))
  return {
    render: (invoice) => Effect.tryPromise({
      try: async () => ({
        bytes: await renderPdf(invoice, await fonts, "invoice", invoiceTemplateVersion),
        mediaType: "application/pdf" as const,
        templateVersion: invoiceTemplateVersion,
      }),
      catch: () => new DocumentRenderingFailure({ template: invoiceTemplateVersion }),
    }),
    renderProforma: (proforma) => Effect.tryPromise({
      try: async () => ({
        bytes: await renderPdf(proforma, await fonts, "proforma", proformaTemplateVersion),
        mediaType: "application/pdf" as const,
        templateVersion: proformaTemplateVersion,
      }),
      catch: () => new DocumentRenderingFailure({ template: proformaTemplateVersion }),
    }),
  }
}
