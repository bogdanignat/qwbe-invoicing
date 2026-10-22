import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { Effect } from "effect"

import { calculateLine, calculateTotals } from "../cubes/invoicing/domain/calculation.ts"
import { negateDecimal } from "../cubes/invoicing/corrections/index.ts"
import { renderEFacturaXml } from "../cubes/invoicing/efactura/index.ts"
import { syntheticFixtures } from "../cubes/invoicing/efactura/fixtures.test-support.ts"
import { mapCorrection, mapIssuedInvoice } from "../kernel/efactura/efactura-mapper.ts"
import { createPdfRenderer } from "../kernel/documents/pdf-renderer.ts"

// T-1905: the money arithmetic moved into one module. These digests were taken
// from the code *before* that refactor, so the shared module has to reproduce
// every amount, XML byte and PDF byte exactly. Change an expectation here only
// together with a deliberate, reviewed change of output. The one so far: T-1908
// prints amounts as `6,600.00` (invoice-v10, storno-v2), so the four PDF digests
// changed and nothing else; the PDF text differs only in its separators. T-1985
// prints a county only when the city does not name it (invoice-v11, storno-v3):
// the issuer's `Botoșani, Botoșani` reads `Botoșani`, so the PDF digests changed.

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const article310 = "Regim special de scutire conform art. 310 din Codul fiscal"
const vat = (code, rate) => ({ code, rate, vatCategoryCode: "S", vatExemptionReason: null, effectiveFrom: "2025-08-01" })
const nonVat = { code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: article310, effectiveFrom: "2025-01-01" }
const unit = { code: "H87", name: "bucată" }
const line = (id, quantity, unitPrice, vatConfiguration) =>
  calculateLine({ id, description: `Linia ${id}`, quantity, unitPrice, unitOfMeasure: unit, vat: vatConfiguration })

// Half-up on either side of the half cent, VAT on a group's base rather than the
// sum of its lines' VAT, untrimmed and unpadded input, and amounts past 2^53.
const taxedLines = [
  line("1", "3.3333", "0.15", vat("RO_STANDARD", "21.00")),
  line("2", "1", "0.07", vat("RO_STANDARD", "21")),
  line("3", "1.0000", "0.07", vat("RO_STANDARD", "21.00")),
  line("4", "001", "0.07", vat("RO_STANDARD", "21.0")),
  line("5", " 2.5 ", "19.99", vat("RO_REDUCED", "11.00")),
  line("6", "0.5", "0.01", vat("RO_REDUCED", "11")),
  line("7", "0.4999", "0.01", vat("RO_REDUCED", "11.00")),
  line("8", "12.3456", "7.89", vat("RO_REDUCED", "11.00")),
]
const exemptLines = [line("1", "2", "0.05", nonVat), line("2", "1.2345", "1000.01", nonVat)]
const largeLines = [
  line("1", "123456789.1234", "98765432.10", vat("RO_STANDARD", "21.00")),
  line("2", "9007199254740993", "1.01", vat("RO_REDUCED", "11.00")),
]

const party = { name: "Client Exemplu SRL", fiscalIdentifier: "87654329",
  address: { countryCode: "RO", city: "Iași", street: "Strada Exemplului 2", county: "RO-IS" } }
const issuer = (vatRegistered) => ({
  branding: null, vatRegistered, legalForm: "srl", tradeRegistryNumber: "J22/123/2020",
  iban: "RO49AAAA1B31007593840000", bankName: "Banca Exemplu", socialCapital: "200.00",
  name: "Exemplu Software SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada Exemplului 1", county: "RO-BT" },
})
const invoiceOf = (lines, vatRegistered) => ({
  id: "invoice-1", organizationId: "org-1", draftId: null, sourceProformaId: null, eFacturaStatus: "not_sent",
  series: "QWBE", number: 7, issueDate: "2026-09-01", dueDate: "2026-09-16", issuedAt: "2026-09-01T10:00:00.000Z",
  actorId: "user-1", currency: "RON", notes: null, issuer: issuer(vatRegistered),
  customer: { partyType: "company", vatRegistered: true, ...party }, lines, ...calculateTotals(lines),
})
const correctionOf = (invoice) => ({
  id: "correction-1", organizationId: "org-1", originalInvoiceId: invoice.id, fiscalYear: 2026, series: "QWBE",
  number: 8, issueDate: "2026-09-20", dueDate: null, notes: null, issuedAt: "2026-09-20T10:00:00.000Z",
  reason: "Stornare integrală", actorId: "user-1", currency: "RON", issuer: invoice.issuer, customer: invoice.customer,
  original: { series: invoice.series, number: invoice.number, issueDate: invoice.issueDate },
  lines: invoice.lines.map((item) => ({ ...item, quantity: negateDecimal(item.quantity),
    totalExcludingVat: negateDecimal(item.totalExcludingVat), vatAmount: negateDecimal(item.vatAmount),
    totalIncludingVat: negateDecimal(item.totalIncludingVat) })),
  vatBreakdown: invoice.vatBreakdown.map((group) => ({ ...group, vatBaseAmount: negateDecimal(group.vatBaseAmount),
    vatAmount: negateDecimal(group.vatAmount) })),
  totalExcludingVat: negateDecimal(invoice.totalExcludingVat), vatTotal: negateDecimal(invoice.vatTotal),
  totalIncludingVat: negateDecimal(invoice.totalIncludingVat),
})

const documentDigests = async (name, invoice) => {
  const correction = correctionOf(invoice)
  const renderer = createPdfRenderer()
  const pdf = async (rendering) => sha256((await Effect.runPromise(rendering)).bytes)
  return {
    [`${name}.snapshot`]: sha256(JSON.stringify([invoice.lines, invoice.vatBreakdown, invoice.totalExcludingVat,
      invoice.vatTotal, invoice.totalIncludingVat, correction.lines, correction.vatBreakdown,
      correction.totalExcludingVat, correction.vatTotal, correction.totalIncludingVat])),
    [`${name}.invoice.xml`]: sha256(renderEFacturaXml(mapIssuedInvoice(invoice))),
    [`${name}.credit-note.xml`]: sha256(renderEFacturaXml(mapCorrection(correction, invoice))),
    [`${name}.invoice.pdf`]: await pdf(renderer.render(invoice)),
    [`${name}.storno.pdf`]: await pdf(renderer.renderCorrection(correction)),
  }
}

void test("the synthetic e-Factura fixtures render to the bytes they had before T-1905", () => {
  const digests = Object.fromEntries(syntheticFixtures.map(({ name, document }) => [name, sha256(renderEFacturaXml(document))]))
  assert.deepEqual(digests, {
    "01-standard-b2b": "28d172a9a058d6d58750a54c48f5271ecf8e95b0a24e995924a63e06b558b1f7",
    "02-consumer-placeholder-id": "a649e1c6b4ca78d95932db29be8dd37c809af74e6d950d795035f5527bed8644",
    "03-bucharest-buyer": "112ffe04beedf1e086b95df97a5923bc47024ebb370c9666042e59a9526cef76",
    "04-article310-exempt-E": "779cf712e59a71f01dbb4cf9c23be14860a35274b435c1e38c6605df3971f1de",
    "05-article310-not-subject-O": "e521026714ece6f5b24f0820eb6a4312f3689c1d6212a233b784667d1e648100",
    "06-credit-note": "605e37d73b74203e1f97025ae0ba55960da642ff3acfd6d6dd13f63054cbd82e",
    "07-consumer-cnp": "da50eb0123f2463730c2e9e4bbfca417b71a1cc38bd482506c5aedbd4c0bb918",
    "08-buyer-without-vat-registration": "322ded6aba3972a81e98251161c59548196ab58603f23dfa893d07972ac7852e",
    "09-article310-credit-note": "9f7705dceeb2d3a1b0e94f64e6924c60433b1b373f2f9b05114368ccdb20324c",
    "10-article310-with-remarks": "35b014d218e960fe01577d9aa33651755109656296bdd5aaafd62ff6ed391f6c",
  })
})

void test("calculated snapshots, their XML and their PDFs are the ones from before T-1905", async () => {
  const digests = {
    ...await documentDigests("taxed", invoiceOf(taxedLines, true)),
    ...await documentDigests("article310", invoiceOf(exemptLines, false)),
  }
  assert.deepEqual(digests, {
    "taxed.snapshot": "9854fd4902bbaaf5c3068ac8d76ec75040a7c59af528bace2794d923dba50c4a",
    "taxed.invoice.xml": "59d57dbee2dd79fd489b0a371c963a9e04952f12fdff0ae49740cd0810685557",
    "taxed.credit-note.xml": "f56b46ccc7182074f4f4e40f483b411210ed75f91d18fe926c27bdf4a0bc5fec",
    "taxed.invoice.pdf": "d8563e8eac8a67e199bde889e927e6a48bdb404d97085b56f20fb7c9a43fbce0",
    "taxed.storno.pdf": "944ccdc4d4f9b05e2a9e11cbc194b417d0af8b731133838997eb57dfc47c8e7a",
    "article310.snapshot": "3a0af2fe5dd56bbe49cf15ca0e758de63b81e0ed997fb1e7c69283ae3105b3c2",
    "article310.invoice.xml": "776e53bf51eff0e0c6f680ecb32921fc9b4a9012c8e53ca238febd8ff06c7fd3",
    "article310.credit-note.xml": "f340d8b1e3e425695d37cc6be115f64e9b69a4354828113881e7a4cb9154d42e",
    "article310.invoice.pdf": "d091885410f59c3c09e90a63a22ad21492f5e17a0be7d5fb530ab252b5bbe7e9",
    "article310.storno.pdf": "414a34a9bc5da0df228edd5f8964da675c9073513ad1d7591d53d31f770d54e4",
  })
})

void test("amounts past 2^53 calculate to the values they had before T-1905", () => {
  const invoice = invoiceOf(largeLines, true)
  assert.deepEqual(invoice.lines.map((item) => [item.quantity, item.totalExcludingVat, item.vatAmount, item.totalIncludingVat]), [
    ["123456789.1234", "12193263123451181.22", "2560585255924748.06", "14753848379375929.28"],
    ["9007199254740993.0000", "9097271247288402.93", "1000699837201724.32", "10097971084490127.25"],
  ])
  assert.deepEqual([invoice.totalExcludingVat, invoice.vatTotal, invoice.totalIncludingVat, correctionOf(invoice).totalIncludingVat],
    ["21290534370739584.15", "3561285093126472.38", "24851819463866056.53", "-24851819463866056.53"])
})
