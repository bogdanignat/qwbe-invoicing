import assert from "node:assert/strict"
import test from "node:test"
import {
  authoringDocumentPayload, newAuthoringForm, newEditableInvoiceLine,
} from "./invoice-authoring-state.ts"
import { proformaAuthoringPayload } from "./proforma-authoring-state.ts"
import type { Issuer } from "./models.ts"

const issuer: Issuer = {
  organizationId: "org-1",
  name: "Emitent",
  fiscalIdentifier: "2",
  legalForm: "srl",
  tradeRegistryNumber: "J07/123/2020",
  iban: "",
  bankName: "",
  socialCapital: "200.00",
  branding: null,
  address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" },
  defaultCurrency: "RON",
  defaultPaymentTermDays: 15,
  vatConfigurations: [],
  currentVat: null,
}

void test("renames authoring series to proformaSeries without leaking series", () => {
  const form = newAuthoringForm(issuer, "PRO", false, "2026-09-20")
  const line = newEditableInvoiceLine(
    "line-1",
    "RO_NON_VAT",
    { code: "C62", name: "unitate" },
  )
  const payload = proformaAuthoringPayload(form, [{
    ...line,
    description: "Serviciu",
    unitPrice: "100.00",
  }])
  const invoicePayload = authoringDocumentPayload(form, [{
    ...line,
    description: "Serviciu",
    unitPrice: "100.00",
  }])
  const { series, ...document } = invoicePayload
  assert.deepEqual(payload, { ...document, proformaSeries: series })
})
