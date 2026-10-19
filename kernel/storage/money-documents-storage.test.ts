import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService, type RequestContextProvider } from "../../cubes/invoicing/index.ts"
import { createPaymentsService } from "../../cubes/invoicing/payments/index.ts"
import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"
import { createPostgresPaymentsStore, createPostgresStore } from "./postgres-store.ts"

/**
 * Documents and payments through the real adapters, with the raw BIGINT columns
 * checked next to what the services return. The storno is under one leu on
 * purpose: "-0.61" is where a sign or a padding mistake in the codec shows.
 */

const context: RequestContextProvider = { current: Effect.succeed({
  identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [
    "invoicing:read", "invoicing:settings.manage", "invoicing:invoice.draft", "invoicing:invoice.issue",
    "invoicing:proforma.issue", "invoicing:invoice.void", "payments:read", "payments:payment.record",
  ] },
  organization: { id: "org-1" },
}) }
const clock = { now: Effect.succeed(new Date("2026-09-01T10:00:00Z")) }
const address = { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }
const customer = { name: "Client", partyType: "individual" as const, fiscalIdentifier: "", vatRegistered: false, address }
const line = (unitPrice: string) =>
  ({ description: "Audit", quantity: "1", unitPrice, unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD" })
let attempts = 0
const attempt = <Request>(request: Request) =>
  ({ request, idempotency: { key: `money-${String(++attempts)}`, fingerprint: `sha256:${"0".repeat(64)}` } })

const services = async (pool: Parameters<typeof createPostgresStore>[0], legalForm: "srl" | "pfa") => {
  let sequence = 0
  const ids = { next: Effect.sync(() => `doc-${String(++sequence)}`) }
  const invoicing = createInvoicingService({ context, clock, ids, store: createPostgresStore(pool),
    branding: { normalize: () => Effect.die("No image in this fixture") }, cubeIdentity: "invoicing" })
  await Effect.runPromise(invoicing.configureIssuer({ name: "Exemplu", fiscalIdentifier: "12345674", address, legalForm,
    tradeRegistryNumber: legalForm === "srl" ? "J22/123/2020" : "F22/123/2020", socialCapital: legalForm === "srl" ? "1000" : "",
    iban: "", bankName: "", defaultCurrency: "RON", defaultPaymentTermDays: 15,
    vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null }))
  await Effect.runPromise(invoicing.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  await Effect.runPromise(invoicing.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  const payments = createPaymentsService({ context, clock, ids, store: createPostgresPaymentsStore(pool), cubeIdentity: "payments" })
  return { invoicing, payments }
}

const stored = (sql: RawSql, statement: string, id: string) => sql.one(statement, [id])
const totalsOf = (table: string) =>
  `SELECT total_excluding_tax,tax_total,total_including_tax,issuer_social_capital FROM ${table} WHERE id=$1`
const lineOf = (table: string, parent: string) =>
  `SELECT unit_price,quantity,total_excluding_tax,tax_amount,total_including_tax FROM ${table} WHERE ${parent}=$1`
const breakdownOf = (table: string, parent: string) => `SELECT taxable_amount,tax_amount FROM ${table} WHERE ${parent}=$1`

void test("a draft, an invoice and its storno under one leu round-trip in bani, signs included", () =>
  withMigrated("money_documents", async ({ pool, sql }) => {
    const { invoicing } = await services(pool, "srl")
    const draft = await Effect.runPromise(invoicing.createDraft(attempt({ customer, series: "INV", issueDate: "2026-09-01", dueDate: "2026-09-16" })))
    const authored = await Effect.runPromise(invoicing.addDraftLine({ draftId: draft.id, ...line("0.50") }))
    assert.deepEqual(await stored(sql, lineOf("draft_lines", "draft_id"), draft.id),
      { unit_price: "50", quantity: "1.0000", total_excluding_tax: "50", tax_amount: "11", total_including_tax: "61" })
    assert.deepEqual((await Effect.runPromise(invoicing.getDraft(draft.id))).lines, authored.lines)

    const invoice = await Effect.runPromise(invoicing.issueInvoice(attempt({ draftId: draft.id })))
    assert.deepEqual([invoice.totalExcludingVat, invoice.vatTotal, invoice.totalIncludingVat], ["0.50", "0.11", "0.61"])
    assert.deepEqual(await stored(sql, totalsOf("issued_invoices"), invoice.id),
      { total_excluding_tax: "50", tax_total: "11", total_including_tax: "61", issuer_social_capital: "100000" })
    assert.deepEqual(await stored(sql, lineOf("issued_lines", "invoice_id"), invoice.id),
      { unit_price: "50", quantity: "1.0000", total_excluding_tax: "50", tax_amount: "11", total_including_tax: "61" })
    assert.deepEqual(await stored(sql, breakdownOf("issued_tax_breakdown", "invoice_id"), invoice.id), { taxable_amount: "50", tax_amount: "11" })
    assert.deepEqual(await Effect.runPromise(invoicing.getIssuedInvoice(invoice.id)), invoice)
    assert.equal((await Effect.runPromise(invoicing.listIssuedInvoices())).items[0]?.totalIncludingVat, "0.61")

    // Storno: negative quantity and totals, unit price still positive.
    const correction = await Effect.runPromise(invoicing.createCorrection(attempt({ originalInvoiceId: invoice.id, reason: "Storno" })))
    assert.deepEqual(await stored(sql, totalsOf("correction_documents"), correction.id),
      { total_excluding_tax: "-50", tax_total: "-11", total_including_tax: "-61", issuer_social_capital: "100000" })
    assert.deepEqual(await stored(sql, lineOf("correction_lines", "correction_id"), correction.id),
      { unit_price: "50", quantity: "-1.0000", total_excluding_tax: "-50", tax_amount: "-11", total_including_tax: "-61" })
    assert.deepEqual(await stored(sql, breakdownOf("correction_tax_breakdown", "correction_id"), correction.id),
      { taxable_amount: "-50", tax_amount: "-11" })
    const read = await Effect.runPromise(invoicing.getCorrection(correction.id))
    assert.deepEqual(read, correction)
    assert.deepEqual([read.totalExcludingVat, read.vatTotal, read.totalIncludingVat], ["-0.50", "-0.11", "-0.61"])
    assert.deepEqual([read.lines[0]?.unitPrice, read.vatBreakdown[0]?.vatBaseAmount], ["0.50", "-0.50"])
    assert.deepEqual(await Effect.runPromise(invoicing.listCorrections(invoice.id)), [correction])
    assert.deepEqual((await Effect.runPromise(invoicing.listInvoiceRegister())).items
      .map(({ kind, totalIncludingVat }) => [kind, totalIncludingVat]), [["correction", "-0.61"], ["invoice", "0.61"]])
  }))

void test("a payment and its reversal store a positive amount and read the invoice total back", () =>
  withMigrated("money_payments", async ({ pool, sql }) => {
    const { invoicing, payments } = await services(pool, "srl")
    const invoice = await Effect.runPromise(invoicing.issueInvoice(attempt({
      customer, series: "INV", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON", lines: [line("1000000.00")] })))
    assert.equal(invoice.totalIncludingVat, "1210000.00")
    const paid = await Effect.runPromise(payments.recordPayment(attempt({
      invoiceId: invoice.id, amount: "1000.05", currency: "RON", paymentDate: "2026-09-01", method: "transfer" })))
    assert.deepEqual([paid.payment.amount, paid.paidAmount, paid.remainingAmount], ["1000.05", "1000.05", "1208999.95"])
    const reversed = await Effect.runPromise(payments.reversePayment(attempt({ invoiceId: invoice.id, paymentId: paid.payment.id })))
    assert.deepEqual([reversed.payment.amount, reversed.remainingAmount], ["1000.05", "1210000.00"])
    assert.deepEqual(await sql.query("SELECT kind,amount FROM invoice_payments ORDER BY kind"),
      [{ kind: "payment", amount: "100005" }, { kind: "reversal", amount: "100005" }])
    assert.deepEqual((await Effect.runPromise(payments.listPayments(invoice.id))).payments.map(({ amount }) => amount), ["1000.05", "1000.05"])
  }))

void test("a PFA proforma without capital becomes an invoice whose capital is NULL", () =>
  withMigrated("money_conversion", async ({ pool, sql }) => {
    const { invoicing } = await services(pool, "pfa")
    const proforma = await Effect.runPromise(invoicing.issueProforma(attempt({
      customer, proformaSeries: "PRO", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON", lines: [line("1234567.89")] })))
    assert.deepEqual(await stored(sql, totalsOf("proformas"), proforma.id),
      { total_excluding_tax: "123456789", tax_total: "25925926", total_including_tax: "149382715", issuer_social_capital: null })
    assert.deepEqual(await stored(sql, breakdownOf("proforma_tax_breakdown", "proforma_id"), proforma.id),
      { taxable_amount: "123456789", tax_amount: "25925926" })
    assert.equal((await stored(sql, lineOf("proforma_lines", "proforma_id"), proforma.id))?.unit_price, "123456789")
    assert.deepEqual(await Effect.runPromise(invoicing.getProforma(proforma.id)), proforma)
    assert.equal((await Effect.runPromise(invoicing.listProformas())).items[0]?.totalIncludingVat, "1493827.15")

    const invoice = await Effect.runPromise(invoicing.issueInvoiceFromProforma(attempt({ proformaId: proforma.id, invoiceSeries: "INV" })))
    assert.equal(invoice.issuer.socialCapital, "")
    assert.deepEqual(invoice.lines, proforma.lines)
    assert.deepEqual(await stored(sql, totalsOf("issued_invoices"), invoice.id),
      { total_excluding_tax: "123456789", tax_total: "25925926", total_including_tax: "149382715", issuer_social_capital: null })
  }))
