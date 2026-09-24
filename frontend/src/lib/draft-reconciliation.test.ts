import assert from "node:assert/strict"
import test from "node:test"

import {
  reconcileHeaderUpdate, reconcileLineCreate, reconcileLineUpdate,
} from "./draft-reconciliation.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { InvoiceAuthoringForm } from "./invoice-authoring-model.ts"

const line = (id: string, description: string, unitPrice: string): DraftInvoice["lines"][number] => ({
  id, description, quantity: "1", unitPrice, unitOfMeasure: { code: "C62", name: "unitate" },
  vatRateCode: "RO_STANDARD", vatRate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
  totalExcludingVat: unitPrice, vatAmount: "0.00", totalIncludingVat: unitPrice,
})

const draft = (lines: ReadonlyArray<DraftInvoice["lines"][number]>): DraftInvoice => ({
  id: "draft-1", organizationId: "org", customer: {
    partyType: "company", name: "Alfa", fiscalIdentifier: "123", vatRegistered: false,
    address: { countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1 },
  }, sourceProformaId: null, series: "FCT", issueDate: "2026-01-01",
  dueDate: null, currency: "RON", notes: null, status: "draft", lines,
  vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
})

const intent = { description: "Consultanță", quantity: "1", unitPrice: "100.00", unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD" }
const matching = (id: string): DraftInvoice["lines"][number] => ({
  ...line(id, "Consultanță", "100.00"),
})

const form = (patch: Partial<InvoiceAuthoringForm> = {}): InvoiceAuthoringForm => ({
  buyerMode: "one-time", customerId: "", partyType: "company", name: "Alfa",
  companyTaxIdentifier: "123", individualTaxIdentifier: "", vatRegistered: false,
  countryCode: "RO", city: "B", street: "s", county: "RO-B", sector: 1, postalCode: "",
  series: "FCT", issueDate: "2026-01-01", dueDate: "", dueDateEdited: false, notes: "",
  ...patch,
})

void test("a line create whose answer was lost is persisted when exactly one new line matches", () => {
  const verdict = reconcileLineCreate(intent, new Set(["old-1"]), draft([line("old-1", "Vechi", "1.00"), matching("new-1")]))
  assert.equal(verdict.kind, "persisted")
})

void test("a line create is missing when the fresh read has no new line at all", () => {
  const verdict = reconcileLineCreate(intent, new Set(["old-1"]), draft([line("old-1", "Vechi", "1.00")]))
  assert.equal(verdict.kind, "missing")
})

void test("two indistinguishable new lines cannot be attributed: the save stops instead of guessing", () => {
  const verdict = reconcileLineCreate(intent, new Set(["old-1"]),
    draft([line("old-1", "Vechi", "1.00"), matching("new-1"), matching("new-2")]))
  assert.equal(verdict.kind, "diverged")
  assert.ok(verdict.message.includes("nu poate fi confirmat"))
})

void test("a foreign change while the answer was lost is a divergence, not a silent continuation", () => {
  const verdict = reconcileLineCreate(intent, new Set(["old-1"]),
    draft([line("old-1", "Vechi", "1.00"), line("other-1", "Altceva", "9.00")]))
  assert.equal(verdict.kind, "diverged")
})

void test("an unchanged line next to a matching new line is not mistaken for the new one", () => {
  const verdict = reconcileLineCreate(intent, new Set(["old-1"]),
    draft([matching("old-1"), matching("new-1")]))
  assert.equal(verdict.kind, "persisted")
})

void test("a line update whose answer was lost is persisted when the fresh line matches the intent", () => {
  const verdict = reconcileLineUpdate("old-1", intent, draft([matching("old-1")]))
  assert.equal(verdict.kind, "persisted")
})

void test("a line update is missing when the fresh line still holds the old value", () => {
  const verdict = reconcileLineUpdate("old-1", intent, draft([line("old-1", "Vechi", "1.00")]))
  assert.equal(verdict.kind, "missing")
})

void test("a line update on a line that vanished is a divergence", () => {
  const verdict = reconcileLineUpdate("gone-1", intent, draft([]))
  assert.equal(verdict.kind, "diverged")
})

void test("a header update whose answer was lost is persisted when the fresh header matches", () => {
  const verdict = reconcileHeaderUpdate(form(), draft([]))
  assert.equal(verdict.kind, "persisted")
})

void test("a header update is missing when the fresh header still holds the old value", () => {
  const verdict = reconcileHeaderUpdate(form({ notes: "schimbat" }), draft([]))
  assert.equal(verdict.kind, "missing")
})
