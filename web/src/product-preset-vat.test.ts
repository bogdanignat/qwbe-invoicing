import assert from "node:assert/strict"
import test from "node:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

import { todayIn } from "./format.ts"
import type { InvoiceAuthoringSessionInput } from "./invoice-authoring-session-hooks.ts"
import type { EditableInvoiceLine } from "./invoice-authoring-state.ts"
import { ARTICLE_310_EXEMPTION_REASON, type Issuer, type ProductPreset, type VatCatalogue, type VatRate } from "./models.ts"
import { preferableVatRates, presetVatIssue, presetVatLabel, presetVatOptions } from "./product-preset-vat.ts"
import type { ProformaAuthoringSessionInput } from "./proforma-authoring-hooks.ts"

const standard = { vatCategoryCode: "S", vatExemptionReason: null } as const
const notSubject = { vatCategoryCode: "O", vatExemptionReason: ARTICLE_310_EXEMPTION_REASON } as const
const catalogue: VatCatalogue = { rates: [
  { ...standard, code: "RO_STANDARD", rate: "19.00", kind: "standard", label: "TVA standard 19%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { ...standard, code: "RO_REDUCED_5", rate: "5.00", kind: "reduced", label: "TVA redus 5%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { ...standard, code: "RO_STANDARD", rate: "21.00", kind: "standard", label: "TVA standard 21%", effectiveFrom: "2025-08-01" },
  { ...standard, code: "RO_REDUCED", rate: "11.00", kind: "reduced", label: "TVA redus 11%", effectiveFrom: "2025-08-01" },
  { ...notSubject, code: "RO_NON_VAT", rate: "0.00", kind: "non_vat", label: "Scutit TVA — art. 310", effectiveFrom: "2025-01-01" },
] }
const each = { code: "C62", name: "unitate" }
const book: ProductPreset = { id: "preset-1", organizationId: "org-1", description: "Carte", unitPrice: "40.00", unitOfMeasure: each, preferredVatRateCode: "RO_REDUCED" }
const plain: ProductPreset = { id: "preset-2", organizationId: "org-1", description: "Consultanță", unitPrice: "100.00", unitOfMeasure: each }
// Article 310 until the end of 2025, VAT-registered from 2026.
const issuer: Issuer = {
  organizationId: "org-1", name: "Emitent", fiscalIdentifier: "12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl", tradeRegistryNumber: "J22/1/2020", iban: "", bankName: "", socialCapital: "200.00", branding: null,
  defaultCurrency: "RON", defaultPaymentTermDays: 15, currentVat: null, vatConfigurations: [
    { ...notSubject, code: "RO_NON_VAT", rate: "0.00", effectiveFrom: "2025-08-01", effectiveTo: "2025-12-31" },
    { ...standard, code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2026-01-01" },
    { ...standard, code: "RO_REDUCED", rate: "11.00", effectiveFrom: "2026-01-01" },
  ],
}

interface AuthoringProbe {
  readonly document: { readonly lines: ReadonlyArray<EditableInvoiceLine> }
  readonly actions: { readonly chooseIssueDate: (date: string) => void; readonly choosePreset: (lineKey: string, presetId: string) => void }
}
type Step = (session: AuthoringProbe) => void
const onDate = (date: string): Step => (session) => { session.actions.chooseIssueDate(date) }
const choose = (presetId: string): Step => (session) => { session.actions.choosePreset(session.document.lines[0]?.key ?? "", presetId) }

// Drives the real authoring hook through the actions its form controls call: each step runs in one
// render and updates the hook's own state, which React applies by rendering again.
const lineCodesAfter = <Input,>(useSession: (input: Input) => AuthoringProbe, input: Input, steps: ReadonlyArray<Step>): string => {
  const pending = [...steps]
  const Probe = () => {
    const session = useSession(input)
    pending.shift()?.(session)
    return createElement("output", null, session.document.lines.map(({ vatRateCode }) => vatRateCode).join(","))
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(["product-presets", "authoring"], { items: [book, plain], nextCursor: null })
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)))
    assert.equal(pending.length, 0)
    return html.replace(/^<output>|<\/output>$/g, "")
  } finally { client.clear() }
}

void test("both authoring forms resolve a chosen product's code on the form's issue date", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const invoices = await server.ssrLoadModule("/src/invoice-authoring-session-hooks.ts") as {
    readonly useInvoiceAuthoringSession: (input: InvoiceAuthoringSessionInput) => AuthoringProbe
  }
  const proformas = await server.ssrLoadModule("/src/proforma-authoring-hooks.ts") as {
    readonly useProformaAuthoringSession: (input: ProformaAuthoringSessionInput) => AuthoringProbe
  }
  const shared = { issuer, vatCatalogue: catalogue, customers: [], unitOfMeasures: [each], backgroundErrors: [] }
  const invoice: InvoiceAuthoringSessionInput = { ...shared, invoiceSeries: ["INV"], notify: () => undefined }
  const proforma: ProformaAuthoringSessionInput = { ...shared, proformaSeries: ["PRO"] }
  const forms: ReadonlyArray<{ readonly name: string; readonly codesAfter: (steps: ReadonlyArray<Step>) => string }> = [
    { name: "invoice", codesAfter: (steps) => lineCodesAfter(invoices.useInvoiceAuthoringSession, invoice, steps) },
    { name: "proforma", codesAfter: (steps) => lineCodesAfter(proformas.useProformaAuthoringSession, proforma, steps) },
  ]
  for (const { name, codesAfter } of forms) {
    assert.equal(codesAfter([onDate("2026-03-02"), choose(book.id)]), "RO_REDUCED", name)
    assert.equal(codesAfter([onDate("2025-11-03"), choose(book.id)]), "RO_NON_VAT", name)
    assert.equal(codesAfter([onDate("2026-03-02"), choose(plain.id)]), "RO_STANDARD", name)
    // A later date change leaves the filled line alone: the server refuses the code on the new date,
    // and choosing the product again resolves the exemption there.
    assert.equal(codesAfter([onDate("2026-03-02"), choose(book.id), onDate("2025-11-03")]), "RO_REDUCED", name)
    assert.equal(codesAfter([onDate("2026-03-02"), choose(book.id), onDate("2025-11-03"), choose(book.id)]), "RO_NON_VAT", name)
  }
})

void test("the product editor's today follows Europe/Bucharest, not the browser's zone", () => {
  assert.equal(todayIn("Europe/Bucharest", new Date("2025-07-31T20:59:59Z")), "2025-07-31")
  assert.equal(todayIn("Europe/Bucharest", new Date("2025-07-31T21:00:00Z")), "2025-08-01")
  assert.equal(todayIn("UTC", new Date("2025-07-31T21:00:00Z")), "2025-07-31")
})

void test("the editor offers only taxable rates in force and flags an expired preference until it is replaced", () => {
  const rates = preferableVatRates(catalogue, "2025-08-01")
  assert.deepEqual(rates.map(({ code }) => code), ["RO_STANDARD", "RO_REDUCED"])
  assert.deepEqual(preferableVatRates(catalogue, "2025-07-31").map(({ code }) => code), ["RO_STANDARD", "RO_REDUCED_5"])
  assert.deepEqual(presetVatOptions(rates, [undefined, ""]).map(({ value }) => value), ["", "RO_STANDARD", "RO_REDUCED"])
  assert.deepEqual(presetVatOptions(rates, ["RO_REDUCED", "RO_STANDARD"]).map(({ value }) => value), ["", "RO_STANDARD", "RO_REDUCED"])
  assert.deepEqual(presetVatOptions(rates, ["RO_REDUCED_5", "RO_REDUCED_5"]), [
    { value: "", label: "Implicită emitentului" }, { value: "RO_REDUCED_5", label: "RO_REDUCED_5 (expirată)" },
    { value: "RO_STANDARD", label: "TVA standard 21%" }, { value: "RO_REDUCED", label: "TVA redus 11%" },
  ])
  assert.match(presetVatIssue("RO_REDUCED_5", rates) ?? "", /nu mai este în vigoare/)
  for (const choice of ["", "RO_STANDARD", "RO_REDUCED"]) assert.equal(presetVatIssue(choice, rates), null)
  assert.equal(presetVatLabel(undefined, rates), "Implicită emitentului")
  assert.equal(presetVatLabel("RO_REDUCED", rates), "TVA redus 11%")
  assert.equal(presetVatLabel("RO_REDUCED_5", rates), "RO_REDUCED_5 (expirată)")
})

void test("renders an expired preference or choice as its own option with a blocking warning", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const module = await server.ssrLoadModule("/src/components/PresetVatField.tsx") as {
    readonly PresetVatField: (props: { readonly rates: ReadonlyArray<VatRate>; readonly saved: string | undefined }) => ReactNode
    readonly PresetVatSelect: (props: {
      readonly rates: ReadonlyArray<VatRate>; readonly saved: string | undefined; readonly selected: string; readonly onSelect: (code: string) => void
    }) => ReactNode
  }
  const rates = preferableVatRates(catalogue, "2025-08-01")
  const expired = renderToStaticMarkup(createElement(module.PresetVatField, { rates, saved: "RO_REDUCED_5" }))
  assert.match(expired, /<option value="RO_REDUCED_5" selected="">RO_REDUCED_5 \(expirată\)<\/option>/)
  assert.match(expired, /aria-invalid="true"/)
  assert.match(expired, /class="status-note warning"[^>]*>Cota RO_REDUCED_5 nu mai este în vigoare/)
  const active = renderToStaticMarkup(createElement(module.PresetVatField, { rates, saved: "RO_REDUCED" }))
  assert.match(active, /aria-invalid="false"/)
  assert.doesNotMatch(active, /expirată/)
  // Chosen on 31 July, still on screen on 1 August: the choice keeps its option and blocks the save,
  // next to the saved preference, instead of falling back to the issuer's default.
  const rolledOver = renderToStaticMarkup(createElement(module.PresetVatSelect, { rates, saved: "RO_STANDARD", selected: "RO_REDUCED_5", onSelect: () => undefined }))
  assert.match(rolledOver, /<option value="RO_REDUCED_5" selected="">RO_REDUCED_5 \(expirată\)<\/option>/)
  assert.match(rolledOver, /aria-invalid="true"/)
  assert.match(rolledOver, /Cota RO_REDUCED_5 nu mai este în vigoare/)
  assert.equal(rolledOver.match(/<option /g)?.length, 4)
})
