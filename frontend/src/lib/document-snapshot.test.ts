import assert from "node:assert/strict"
import test from "node:test"

import { decodeCorrectionDocument, decodeIssuedInvoice } from "./document-snapshot-decoders.ts"
import { projectCorrectionDocument, projectIssuedInvoice } from "./document-projection.ts"

/**
 * The fixtures carry what the backend actually stores, not readable stand-ins.
 *
 * `county` is an ISO 3166-2 code because `validateParty` refuses anything else,
 * `fiscalIdentifier` is bare digits with a valid CUI checksum because
 * `isValidRomanianCui` refuses a `RO` prefix, and the VAT tuple is one the
 * catalogue actually emits (`RO_STANDARD`/`21.00`/`S`, `RO_NON_VAT`/`0.00`/`O`).
 * A fixture that spelled `București` or `RO12345678` would pass while the
 * screen printed `RO-B` and `RORO12345678` in front of a real document.
 */
const issuer = {
  name: "Qwbe Software SRL",
  fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "București", street: "Str. Lungă 1", county: "RO-B", sector: 3, postalCode: "030123" },
  legalForm: "srl",
  tradeRegistryNumber: "J40/1234/2020",
  iban: "RO49AAAA1B31007593840000",
  bankName: "Banca Transilvania",
  socialCapital: "200.00",
  vatRegistered: true,
}

const customer = {
  name: "Alfa SRL",
  fiscalIdentifier: "87654329",
  address: { countryCode: "RO", city: "Cluj-Napoca", street: "Str. Scurtă 2", county: "RO-CJ" },
  partyType: "company",
  vatRegistered: true,
}

const line = {
  id: "line-1",
  description: "Abonament lunar",
  quantity: "2",
  unitPrice: "500.00",
  unitOfMeasure: { code: "H87", name: "bucată" },
  vatRateCode: "RO_STANDARD",
  vatRate: "21.00",
  vatCategoryCode: "S",
  vatExemptionReason: null,
  totalExcludingVat: "1000.00",
  vatAmount: "210.00",
  totalIncludingVat: "1210.00",
}

const article310Reason = "Regim special de scutire conform art. 310 din Codul fiscal"

const exemptLine = {
  ...line,
  id: "line-2",
  vatRateCode: "RO_NON_VAT",
  vatRate: "0.00",
  vatCategoryCode: "O",
  vatExemptionReason: article310Reason,
  vatAmount: "0.00",
  totalIncludingVat: "1000.00",
}

const body = {
  issuer,
  customer,
  lines: [line],
  vatBreakdown: [{ code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "1000.00", vatAmount: "210.00" }],
  totalExcludingVat: "1000.00",
  vatTotal: "210.00",
  totalIncludingVat: "1210.00",
  currency: "RON",
  series: "FCT",
  number: 12,
  issueDate: "2026-02-03",
}

const exemptInvoiceJson = {
  ...body,
  id: "inv-2",
  dueDate: null,
  notes: null,
  eFacturaStatus: "not_sent",
  issuer: { ...issuer, vatRegistered: false, iban: "", bankName: "", socialCapital: "" },
  lines: [exemptLine],
  vatBreakdown: [{ code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: article310Reason, vatBaseAmount: "1000.00", vatAmount: "0.00" }],
  vatTotal: "0.00",
  totalIncludingVat: "1000.00",
}

const invoiceJson = { ...body, id: "inv-1", dueDate: "2026-03-05", notes: "Plata prin transfer", eFacturaStatus: "accepted" }

const without = (source: Readonly<Record<string, unknown>>, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(source).filter(([key]) => key !== field))

const correctionJson = {
  ...body,
  lines: [{ ...line, quantity: "-2", totalExcludingVat: "-1000.00", vatAmount: "-210.00", totalIncludingVat: "-1210.00" }],
  vatBreakdown: [{ code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "-1000.00", vatAmount: "-210.00" }],
  totalExcludingVat: "-1000.00",
  vatTotal: "-210.00",
  totalIncludingVat: "-1210.00",
  series: "STR",
  number: 4,
  id: "cor-1",
  originalInvoiceId: "inv-1",
  reason: "Anulare factură emisă greșit",
}

void test("an issued invoice decodes with its head and its whole body", () => {
  const invoice = decodeIssuedInvoice(invoiceJson)
  assert.equal(invoice.id, "inv-1")
  assert.equal(invoice.dueDate, "2026-03-05")
  assert.equal(invoice.notes, "Plata prin transfer")
  assert.equal(invoice.lines.length, 1)
  assert.equal(invoice.issuer.address.sector, 3)
  assert.equal(invoice.customer.partyType, "company")
})

void test("optional address parts are omitted rather than set to null", () => {
  const invoice = decodeIssuedInvoice(invoiceJson)
  assert.equal("sector" in invoice.customer.address, false)
  assert.equal("postalCode" in invoice.customer.address, false)
})

void test("an invoice with neither due date nor notes keeps both nulls", () => {
  const invoice = decodeIssuedInvoice({ ...invoiceJson, dueDate: null, notes: null })
  assert.equal(invoice.dueDate, null)
  assert.equal(invoice.notes, null)
})

void test("a correction decodes with the invoice it reverses and the reason", () => {
  const correction = decodeCorrectionDocument(correctionJson)
  assert.equal(correction.originalInvoiceId, "inv-1")
  assert.equal(correction.reason, "Anulare factură emisă greșit")
})

void test("a buyer type outside the contract is refused", () => {
  assert.throws(
    () => decodeIssuedInvoice({ ...invoiceJson, customer: { ...customer, partyType: "charity" } }),
    /invalid partyType/u,
  )
})

void test("a total sent as a number instead of a decimal string is refused", () => {
  // Amounts stay strings end to end; accepting a float here is how a fiscal
  // total silently loses its last cent.
  assert.throws(() => decodeIssuedInvoice({ ...invoiceJson, totalIncludingVat: 1190 }), /invalid totalIncludingVat/u)
})

void test("a missing issuer field fails the document rather than rendering blank", () => {
  assert.throws(() => decodeIssuedInvoice({ ...invoiceJson, issuer: without(issuer, "iban") }), /invalid iban/u)
})

void test("a line that is not an object fails the document", () => {
  assert.throws(() => decodeIssuedInvoice({ ...invoiceJson, lines: [null] }), /expected object/u)
  assert.throws(() => decodeIssuedInvoice({ ...invoiceJson, lines: {} }), /invalid lines/u)
})

void test("a correction without its reason is refused", () => {
  assert.throws(() => decodeCorrectionDocument(without(correctionJson, "reason")), /invalid reason/u)
})

void test("an invoice projects its facts, parties and totals as strings", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(invoiceJson))
  assert.equal(view.heading, "FCT 12")
  assert.deepEqual(view.facts, [
    { label: "Emisă", value: "2026-02-03" },
    { label: "Scadență", value: "2026-03-05" },
    { label: "Monedă", value: "RON" },
    { label: "e-Factura", value: "Acceptată" },
  ])
  assert.deepEqual(view.totals.map((total) => total.value), ["1000.00 RON", "210.00 RON", "1210.00 RON"])
  assert.deepEqual(view.parties.map((party) => party.heading), ["Furnizor", "Cumpărător"])
  assert.equal(view.originalInvoice, null)
})

// The county arrives as `RO-B`/`RO-CJ`; printing the code on a fiscal document
// is the regression this asserts against, sector included.
void test("an address resolves its ISO county code to the county name", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(invoiceJson))
  assert.equal(
    view.parties[0]?.details.includes("Str. Lungă 1, București, București, Sector 3, 030123, RO"),
    true,
  )
  assert.equal(view.parties[1]?.details.includes("Str. Scurtă 2, Cluj-Napoca, Cluj, RO"), true)
})

void test("an unknown county code is printed as stored rather than renamed", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice({
    ...invoiceJson,
    customer: { ...customer, address: { ...customer.address, county: "RO-ZZ" } },
  }))
  assert.equal(view.parties[1]?.details.includes("Str. Scurtă 2, Cluj-Napoca, RO-ZZ, RO"), true)
})

void test("the issuer states its VAT code once, RO prefixed, next to the bare CUI", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(invoiceJson))
  const details = view.parties[0]?.details ?? []
  assert.equal(details.includes("CUI / CIF 12345674"), true)
  assert.equal(details.includes("Cod TVA RO12345674"), true)
  assert.equal(details.some((detail) => detail.includes("RORO")), false)
  assert.equal(details.includes("Capital social 200.00 RON"), true)
  assert.equal(details.includes("IBAN RO49AAAA1B31007593840000"), true)
  assert.equal(details.includes("Bancă Banca Transilvania"), true)
})

void test("an issuer without IBAN, bank or capital omits those lines instead of leaving them blank", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(exemptInvoiceJson))
  const details = view.parties[0]?.details ?? []
  assert.equal(details.some((detail) => detail.startsWith("IBAN")), false)
  assert.equal(details.some((detail) => detail.startsWith("Bancă")), false)
  assert.equal(details.some((detail) => detail.startsWith("Capital social")), false)
  // An article 310 issuer has no VAT code; the negative is stated rather than implied.
  assert.equal(details.some((detail) => detail.startsWith("Cod TVA")), false)
  assert.equal(details.includes("Neplătitor de TVA"), true)
})

void test("a line carries its unit by name, its VAT treatment and its three amounts", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(invoiceJson))
  assert.deepEqual(view.lines[0], {
    key: "line-1",
    description: "Abonament lunar",
    quantity: "2 bucată (H87)",
    unitPrice: "500.00 RON",
    vat: "TVA 21.00%",
    totalExcludingVat: "1000.00 RON",
    vatAmount: "210.00 RON",
    totalIncludingVat: "1210.00 RON",
  })
})

// Category `O` is stored with rate "0.00" because the model requires a rate, but
// `0.00%` is not the mention the law asks for and not what legacy prints.
void test("an article 310 line reads as the exemption, never as a zero rate", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(exemptInvoiceJson))
  const vat = view.lines[0]?.vat ?? ""
  assert.equal(vat, "Scutit TVA — art. 310")
  assert.equal(vat.includes("%"), false)
  assert.equal(vat.includes("RO_NON_VAT"), false)
})

void test("the exempt VAT breakdown row states the treatment and the legal reason", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(exemptInvoiceJson))
  assert.deepEqual(view.vatRows[0], {
    key: "O-0.00",
    rate: "Scutit TVA — art. 310",
    base: "1000.00 RON",
    amount: "0.00 RON",
    note: article310Reason,
  })
})

void test("an e-Factura status reads in the same words as the register", () => {
  assert.equal(
    projectIssuedInvoice(decodeIssuedInvoice(exemptInvoiceJson)).facts
      .find((fact) => fact.label === "e-Factura")?.value,
    "Netrimisă",
  )
})

void test("an e-Factura status outside the contract fails the document", () => {
  assert.throws(() => decodeIssuedInvoice({ ...invoiceJson, eFacturaStatus: "queued" }), /invalid eFacturaStatus/u)
})

// The correction's amounts arrive signed and are rendered signed: the screen is
// a reading of a fiscal document, not a recalculation of it.
void test("a correction projects its negative totals unchanged", () => {
  const view = projectCorrectionDocument(decodeCorrectionDocument(correctionJson))
  assert.deepEqual(view.totals.map((total) => total.value), ["-1000.00 RON", "-210.00 RON", "-1210.00 RON"])
  assert.equal(view.lines[0]?.totalIncludingVat, "-1210.00 RON")
  assert.equal(view.heading, "STR 4")
})

void test("a correction states its reason and links back to the original invoice", () => {
  const view = projectCorrectionDocument(decodeCorrectionDocument(correctionJson))
  assert.deepEqual(view.facts, [
    { label: "Emisă", value: "2026-02-03" },
    { label: "Monedă", value: "RON" },
    { label: "Motiv", value: "Anulare factură emisă greșit" },
  ])
  assert.deepEqual(view.originalInvoice, { label: "Vezi factura inițială", href: "/invoices/inv-1" })
  assert.equal(view.notes, null)
})

void test("a taxable VAT row states its rate and reads its absent reason as a dash", () => {
  const view = projectIssuedInvoice(decodeIssuedInvoice(invoiceJson))
  assert.deepEqual(view.vatRows[0], {
    key: "S-21.00", rate: "TVA 21.00%", base: "1000.00 RON", amount: "210.00 RON", note: "—",
  })
})
