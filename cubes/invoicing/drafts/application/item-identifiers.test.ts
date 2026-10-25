import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, idempotent, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { ValidationFailure } from "../../contracts/index.ts"
import type { DraftLine } from "../../domain/invoice.ts"

const setup = async () => {
  const state = emptyState()
  const service = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }), clock: fixedClock,
    ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
    legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
    defaultCurrency: "RON", defaultPaymentTermDays: 15, branding: null, vatChange: { registered: true, effectiveFrom: "2025-08-01" },
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  return { state, service }
}

const header = {
  customer: { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2", county: "RO-IS" } },
  series: "QWBE", issueDate: "2026-09-01", dueDate: "2026-09-15",
}
const coded = { description: "Șurub M6", quantity: "2", unitPrice: "1.50", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  itemCode: " SRB-M6 ", barcode: "00012345600012" }
const manual = { description: "Manoperă", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }
const identifiers = (line: DraftLine | undefined) => ({ itemCode: line?.itemCode, barcode: line?.barcode })
const hasIdentifiers = (line: DraftLine | undefined): boolean =>
  line !== undefined && (Object.hasOwn(line, "itemCode") || Object.hasOwn(line, "barcode"))
const issues = (failure: unknown): string => failure instanceof ValidationFailure ? failure.issues.join("; ") : String(failure)

void test("a line keeps the article code (trimmed) and the GTIN it is given; a line typed by hand has neither", async () => {
  const { service } = await setup()
  const draft = await Effect.runPromise(service.createDraft(idempotent({ ...header, lines: [coded, manual] })))
  assert.deepEqual(identifiers(draft.lines[0]), { itemCode: "SRB-M6", barcode: "00012345600012" })
  assert.equal(hasIdentifiers(draft.lines[1]), false)
  const added = await Effect.runPromise(service.addDraftLine({ draftId: draft.id, ...manual, itemCode: "MAN" }))
  assert.deepEqual(identifiers(added.lines[2]), { itemCode: "MAN", barcode: undefined })
  const [first] = draft.lines
  assert.ok(first !== undefined)
  // Saving the line without them clears both: absent stays absent, never an empty string.
  const cleared = await Effect.runPromise(service.updateDraftLine({ draftId: draft.id, lineId: first.id, ...manual }))
  assert.equal(hasIdentifiers(cleared.lines[0]), false)
})

void test("refuses a malformed article code or GTIN on a line", async () => {
  const { service } = await setup()
  const draft = await Effect.runPromise(service.createDraft(idempotent({ ...header })))
  for (const [change, issue] of [
    [{ itemCode: "" }, "itemCode must be 1-50 printable ASCII characters"],
    [{ itemCode: "x".repeat(51) }, "itemCode must be 1-50 printable ASCII characters"],
    [{ itemCode: "A\tB" }, "itemCode must be 1-50 printable ASCII characters"],
    [{ itemCode: "ȘURUB" }, "itemCode must be 1-50 printable ASCII characters"],
    [{ barcode: "4006381333932" }, "barcode must be a GTIN-8, 12, 13 or 14 with a valid check digit"],
    [{ barcode: "" }, "barcode must be a GTIN-8, 12, 13 or 14 with a valid check digit"],
  ] as const) {
    const failure = await Effect.runPromise(Effect.flip(service.addDraftLine({ draftId: draft.id, ...manual, ...change })))
    assert.equal(issues(failure), issue, JSON.stringify(change))
    const created = await Effect.runPromise(Effect.flip(service.createDraft(idempotent({ ...header, lines: [{ ...manual, ...change }] }))))
    assert.equal(issues(created), issue, JSON.stringify(change))
  }
})

void test("a new date recalculates the VAT and keeps the identifiers; the product's later edits and deletion change nothing", async () => {
  const { service } = await setup()
  const product = await Effect.runPromise(service.createProductPreset({
    code: "SRB-M6", kind: "goods", description: "Șurub M6", unitPrice: "1.50", unitOfMeasure: each, barcode: "00012345600012",
  }))
  const { code, barcode } = product
  assert.ok(barcode !== undefined)
  const draft = await Effect.runPromise(service.createDraft(idempotent({ ...header, lines: [{ ...manual,
    description: product.description, itemCode: code, barcode }] })))
  const redated = await Effect.runPromise(service.updateDraft({ customer: header.customer, draftId: draft.id, issueDate: "2026-08-31" }))
  assert.deepEqual(identifiers(redated.lines[0]), { itemCode: "SRB-M6", barcode: "00012345600012" })
  await Effect.runPromise(service.updateProductPreset({ id: product.id, code: "SRB-M8", kind: "goods", description: "Șurub M8",
    unitPrice: "2", unitOfMeasure: each }))
  await Effect.runPromise(service.deleteProductPreset(product.id))
  assert.deepEqual((await Effect.runPromise(service.getDraft(draft.id))).lines, redated.lines)
})

void test("issuance, both proforma conversions and the storno copy the identifiers of the lines they start from", async () => {
  const { service } = await setup()
  const invoice = await Effect.runPromise(service.issueInvoice(idempotent({ ...header, currency: "RON" as const, lines: [coded, manual] })))
  assert.deepEqual(identifiers(invoice.lines[0]), { itemCode: "SRB-M6", barcode: "00012345600012" })
  assert.equal(hasIdentifiers(invoice.lines[1]), false)
  const correction = await Effect.runPromise(service.createCorrection(idempotent({ originalInvoiceId: invoice.id, reason: "Retur" })))
  assert.deepEqual(identifiers(correction.lines[0]), { itemCode: "SRB-M6", barcode: "00012345600012" })
  assert.equal(correction.lines[0]?.quantity, "-2.0000")
  assert.equal(hasIdentifiers(correction.lines[1]), false)

  const proforma = () => Effect.runPromise(service.issueProforma(idempotent({ customer: header.customer, issueDate: header.issueDate,
    dueDate: header.dueDate, proformaSeries: "PRO", currency: "RON" as const, lines: [coded] })))
  const first = await proforma()
  assert.deepEqual(identifiers(first.lines[0]), { itemCode: "SRB-M6", barcode: "00012345600012" })
  const fromProforma = await Effect.runPromise(service.issueInvoiceFromProforma(idempotent({ proformaId: first.id, invoiceSeries: "QWBE" })))
  assert.deepEqual(identifiers(fromProforma.lines[0]), { itemCode: "SRB-M6", barcode: "00012345600012" })
  const derived = await Effect.runPromise(service.createDraftInvoiceFromProforma(idempotent({ proformaId: (await proforma()).id, invoiceSeries: "QWBE" })))
  assert.deepEqual(identifiers(derived.lines[0]), { itemCode: "SRB-M6", barcode: "00012345600012" })
})
