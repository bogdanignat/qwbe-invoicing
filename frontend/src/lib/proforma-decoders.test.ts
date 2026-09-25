import assert from "node:assert/strict"
import test from "node:test"

import { decodeProforma, decodeProformaPage } from "./proforma-decoders.ts"

/**
 * The fixture is what `ProformaSummary` actually answers.
 *
 * `county` is an ISO 3166-2 code and `fiscalIdentifier` bare digits with a valid
 * checksum, as everywhere else: a decoder test that accepted `București` would
 * pass while the real answer failed. The issuer here is an `IssuerCompanySnapshot`
 * — the shape the list returns, without branding — which is why the list and the
 * detail can share one decoder.
 */
const issuer = {
  name: "Qwbe Software SRL",
  fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "București", street: "Str. Lungă 1", county: "RO-B", sector: 3 },
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
  description: "Avans",
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

const payload = {
  actorId: "actor-1",
  organizationId: "org-1",
  issuedAt: "2026-02-01T10:00:00.000Z",
  id: "prf-1",
  sourceDraftId: null,
  convertedDraftId: null,
  convertedInvoiceId: null,
  series: "PRO",
  number: 7,
  issueDate: "2026-02-01",
  dueDate: "2026-02-15",
  currency: "RON",
  notes: "Plata în 14 zile",
  issuer,
  customer,
  lines: [line],
  vatBreakdown: [{ code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "1000.00", vatAmount: "210.00" }],
  totalExcludingVat: "1000.00",
  vatTotal: "210.00",
  totalIncludingVat: "1210.00",
}

/** The fixture minus some fields, to check what the decoder refuses to accept. */
const payloadWithout = (...dropped: ReadonlyArray<string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(payload).filter(([key]) => !dropped.includes(key)))

void test("a proforma decodes into the body it shares and the head that is its own", () => {
  const proforma = decodeProforma({ ...payload, convertedInvoiceId: "inv-9" })

  assert.equal(proforma.id, "prf-1")
  assert.equal(proforma.series, "PRO")
  assert.equal(proforma.number, 7)
  assert.equal(proforma.dueDate, "2026-02-15")
  assert.equal(proforma.notes, "Plata în 14 zile")
  assert.equal(proforma.sourceDraftId, null)
  assert.equal(proforma.convertedInvoiceId, "inv-9")
  assert.equal(proforma.convertedDraftId, null)
  assert.equal(proforma.customer.name, "Alfa SRL")
  assert.equal(proforma.issuer.tradeRegistryNumber, "J40/1234/2020")
  assert.equal(proforma.lines.length, 1)
  assert.equal(proforma.vatBreakdown[0]?.vatBaseAmount, "1000.00")
  assert.equal(proforma.totalIncludingVat, "1210.00")
  // Fields the screens never render are not carried into the model.
  assert.equal("issuedAt" in proforma, false)
  assert.equal("organizationId" in proforma, false)
})

void test("an absent due date, an absent note and a draft origin stay null rather than undefined", () => {
  const proforma = decodeProforma({ ...payload, dueDate: null, notes: null, sourceDraftId: "draft-3", convertedDraftId: "draft-4" })

  assert.equal(proforma.dueDate, null)
  assert.equal(proforma.notes, null)
  assert.equal(proforma.sourceDraftId, "draft-3")
  assert.equal(proforma.convertedDraftId, "draft-4")
})

void test("a conversion field the server stopped sending fails at the boundary", () => {
  assert.throws(() => decodeProforma(payloadWithout("convertedInvoiceId")), /convertedInvoiceId/u)
})

/**
 * The reason a proforma is not decoded as an `IssuedInvoice`: an invoice answer
 * carries no conversion ids at all, so accepting one here would produce a
 * document whose conversion section could not be derived. The check is on the
 * decoder rather than on the type, because the shape arrives at runtime.
 */
void test("an issued-invoice answer is refused, not adopted", () => {
  const body = payloadWithout("sourceDraftId", "convertedDraftId", "convertedInvoiceId")
  const invoice = { ...body, draftId: null, sourceProformaId: null, eFacturaStatus: "not_sent" }

  assert.throws(() => decodeProforma(invoice), /sourceDraftId/u)
})

void test("a number that is not an integer, and a non-object answer, are both refused", () => {
  assert.throws(() => decodeProforma({ ...payload, number: 7.5 }), /number/u)
  assert.throws(() => decodeProforma([payload]), /expected object/u)
})

void test("a page decodes its items under the shared cursor envelope", () => {
  const page = decodeProformaPage({ items: [payload, { ...payload, id: "prf-2", number: 8 }], nextCursor: "prf-2" })

  assert.deepEqual(page.items.map((item) => item.id), ["prf-1", "prf-2"])
  assert.equal(page.nextCursor, "prf-2")
  assert.equal(decodeProformaPage({ items: [], nextCursor: null }).nextCursor, null)
  assert.throws(() => decodeProformaPage({ items: [{ ...payload, id: 3 }], nextCursor: null }), /id/u)
})
