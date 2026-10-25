import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

import { ANAF_ENVIRONMENTS } from "../../cubes/invoicing/efactura/connection/index.ts"

const Instant = Schema.String.annotations({ description: "ISO instant." })

/** A fetch as the API shows it: never the organization, never a token or ANAF's raw answer. */
export const EFacturaReceivedFetch = Schema.Struct({
  id: Schema.String, environment: Schema.Literal(...ANAF_ENVIRONMENTS), cif: Schema.String,
  window: Schema.Struct({
    start: Instant, end: Instant,
    gap: Schema.optional(Schema.Struct({ from: Instant, until: Instant })).annotations({
      description: "Between the last coverage and `start`: days ANAF no longer lists. Absent when there is no such gap.",
    }),
  }),
  state: Schema.Literal("listing", "downloading", "completed", "failed").annotations({ description: "Active while listing or downloading." }),
  pagesListed: Schema.Int, pagesTotal: Schema.Int.annotations({ description: "ANAF's page count in its last answer; 0 before the first." }),
  found: Schema.Int, queued: Schema.Int, downloaded: Schema.Int, failed: Schema.Int,
  errors: Schema.Array(Schema.String).annotations({ description: "Why it failed: the dispatcher's codes or ANAF's messages, sanitized." }),
  createdBy: Schema.String, createdAt: Instant, updatedAt: Instant,
})
export const EFacturaReceivedStatus = Schema.Struct({
  fetch: Schema.NullOr(EFacturaReceivedFetch).annotations({ description: "The latest fetch in the current environment." }),
  coveredUntil: Schema.NullOr(Instant).annotations({ description: "Received invoices are fetched completely up to here; null before the first complete fetch." }),
})

const Listing = Schema.Struct({
  kind: Schema.Literal("invoice", "credit_note"), number: Schema.String, issueDate: Schema.String, currency: Schema.String,
  supplierName: Schema.String, supplierCif: Schema.String,
  totalExcludingTax: Schema.String, taxTotal: Schema.String, payable: Schema.String,
}).annotations({ description: "As the XML writes it, in the document's currency; a credit note keeps its own signs." })
const Reason = Schema.Union(
  Schema.Struct({ source: Schema.Literal("zip"), refusal: Schema.String }),
  Schema.Struct({ source: Schema.Literal("encoding") }),
  Schema.Struct({ source: Schema.Literal("ubl"), failure: Schema.Union(
    Schema.Struct({ reason: Schema.Literal("xml"), refusal: Schema.String }),
    Schema.Struct({ reason: Schema.Literal("not_ubl") }),
    Schema.Struct({ reason: Schema.Literal("unbound_prefix", "missing", "duplicate", "invalid"), field: Schema.String }),
  ) }),
).annotations({ description: "Why the archive could not be read; it is kept and downloadable all the same." })
const TotalsCode = Schema.Literal("lines_total_mismatch", "tax_inclusive_mismatch")
const BuyerCode = Schema.Literal("buyer_cif_mismatch")
const Warning = Schema.Union(
  Schema.Struct({ code: TotalsCode, declared: Schema.String, computed: Schema.String }),
  Schema.Struct({ code: BuyerCode, expected: Schema.String, found: Schema.Array(Schema.String) }),
)
const Message = {
  messageId: Schema.String.annotations({ description: "ANAF's message id: the `{id}` of the routes below." }),
  spvCreatedAt: Schema.String.annotations({ description: "ANAF's `data_creare` as listed: `YYYYMMDDHHmm`, Romanian time." }),
  storedAt: Instant,
}
const Unreadable = Schema.Struct({ ...Message, readable: Schema.Literal(false), reason: Reason })
export const EFacturaReceivedSummary = Schema.Union(
  Schema.Struct({ ...Message, readable: Schema.Literal(true), listing: Listing,
    dueDate: Schema.optional(Schema.String).annotations({ description: "The document's due date; absent when it has none." }),
    warnings: Schema.Array(Schema.Union(TotalsCode, BuyerCode)).annotations({ description: "The codes of its warnings; the detail has them in full." }) }),
  Unreadable,
)
export const EFacturaReceivedDetail = Schema.Union(
  Schema.Struct({ ...Message, readable: Schema.Literal(true), listing: Listing, warnings: Schema.Array(Warning),
    content: Schema.Unknown.annotations({ jsonSchema: { type: "object" }, description: "The whole normalized document: parties, "
      + "references, allowances and charges, totals, VAT by rate and lines, at the XML's precision; a field the XML lacks is absent." }) }),
  Unreadable,
)
export const EFacturaReceivedArchive = HttpApiSchema.Uint8Array({ contentType: "application/zip" })
