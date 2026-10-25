import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../cubes/invoicing/index.ts"
import { withMigrated } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * The article code and the GTIN a line copies from the product, as PostgreSQL
 * keeps them on the four line tables: present values round-trip as written,
 * absent ones are NULL, and every table refuses a malformed value with the same
 * CHECK the catalog uses.
 */

const lineTables = ["draft_lines", "issued_lines", "proforma_lines", "correction_lines"] as const

const service = (pool: Parameters<typeof createPostgresStore>[0]) => {
  let sequence = 0
  return createInvoicingService({
    context: { current: Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [
      "invoicing:read", "invoicing:settings.manage", "invoicing:invoice.draft", "invoicing:invoice.issue",
      "invoicing:proforma.issue", "invoicing:invoice.void",
    ] }, organization: { id: "org-1" } }) },
    ids: { next: Effect.sync(() => `item-${String(++sequence)}`) },
    clock: { now: Effect.succeed(new Date("2026-09-01T10:00:00Z")) },
    branding: { normalize: () => Effect.die("No image in this fixture") },
    store: createPostgresStore(pool), cubeIdentity: "invoicing",
  })
}

const each = { code: "C62", name: "unitate" }
const attempt = (key: string) => ({ key, fingerprint: `sha256:${"0".repeat(64)}` })
const header = {
  customer: { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
    address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2", county: "RO-IS" } },
  issueDate: "2026-09-01", dueDate: "2026-09-15", currency: "RON" as const,
}
const coded = { description: "Șurub M6", quantity: "2", unitPrice: "1.50", unitOfMeasure: each, vatRateCode: "RO_STANDARD",
  itemCode: "SRB-M6", barcode: "00012345600012" }
const manual = { description: "Manoperă", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }

const prepared = async (pool: Parameters<typeof createPostgresStore>[0]) => {
  const invoicing = service(pool)
  await Effect.runPromise(invoicing.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
    legalForm: "srl", tradeRegistryNumber: "J22/123/2020", socialCapital: "1000", iban: "", bankName: "",
    defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null,
  }))
  await Effect.runPromise(invoicing.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  await Effect.runPromise(invoicing.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
  return invoicing
}

void test("each line table keeps the identifiers as written and an absent one as NULL, storno included", () =>
  withMigrated("item_lines", async ({ pool, sql }) => {
    const invoicing = await prepared(pool)
    const draft = await Effect.runPromise(invoicing.createDraft({ request: { ...header, series: "QWBE", lines: [coded, manual] },
      idempotency: attempt("draft-1") }))
    const invoice = await Effect.runPromise(invoicing.issueInvoice({ request: { draftId: draft.id },
      idempotency: attempt("issue-1") }))
    const proforma = await Effect.runPromise(invoicing.issueProforma({ request: { ...header, proformaSeries: "PRO", lines: [coded, manual] },
      idempotency: attempt("proforma-1") }))
    const correction = await Effect.runPromise(invoicing.createCorrection({ request: { originalInvoiceId: invoice.id, reason: "Retur" },
      idempotency: attempt("storno-1") }))
    for (const table of lineTables) {
      assert.deepEqual(await sql.query(`SELECT item_code, barcode FROM ${table} ORDER BY line_position`), [
        { item_code: "SRB-M6", barcode: "00012345600012" }, { item_code: null, barcode: null },
      ], table)
    }
    const reads = [
      await Effect.runPromise(invoicing.getDraft(draft.id)), await Effect.runPromise(invoicing.getIssuedInvoice(invoice.id)),
      await Effect.runPromise(invoicing.getProforma(proforma.id)), await Effect.runPromise(invoicing.getCorrection(correction.id)),
    ]
    for (const document of reads) {
      assert.deepEqual([document.lines[0]?.itemCode, document.lines[0]?.barcode], ["SRB-M6", "00012345600012"])
      assert.equal(Object.hasOwn(document.lines[1] ?? {}, "itemCode") || Object.hasOwn(document.lines[1] ?? {}, "barcode"), false)
    }
  }))

void test("every line table checks the identifiers with the catalog's own expressions, and refuses a malformed one", () =>
  withMigrated("item_checks", async ({ pool, sql }) => {
    const definition = async (name: string): Promise<string> =>
      String(await sql.scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname=$1", [name]))
    const code = (await definition("product_presets_code_shape")).replaceAll("code", "item_code")
    const barcode = await definition("product_presets_barcode_gtin")
    for (const table of lineTables) {
      assert.equal(await definition(`${table}_item_code_shape`), code.replace("CHECK (", "CHECK (((item_code IS NULL) OR ").replace(/\)$/u, "))"), table)
      assert.equal(await definition(`${table}_barcode_gtin`), barcode, table)
    }
    const invoicing = await prepared(pool)
    const draft = await Effect.runPromise(invoicing.createDraft({ request: { ...header, series: "QWBE", lines: [manual] },
      idempotency: attempt("draft-1") }))
    for (const [column, value, constraint] of [
      ["barcode", "4006381333932", "draft_lines_barcode_gtin"], ["barcode", "", "draft_lines_barcode_gtin"],
      ["item_code", "", "draft_lines_item_code_shape"], ["item_code", " X", "draft_lines_item_code_shape"],
      ["item_code", "x".repeat(51), "draft_lines_item_code_shape"], ["item_code", "A\nB", "draft_lines_item_code_shape"],
      ["item_code", "ȘURUB", "draft_lines_item_code_shape"],
    ] as const) {
      const failure = await sql.rejects(`UPDATE draft_lines SET ${column}=$1 WHERE draft_id=$2`, [value, draft.id])
      assert.equal(`${failure.code} ${String(failure.constraint)}`, `23514 ${constraint}`, `${column}=${JSON.stringify(value)}`)
    }
  }))
