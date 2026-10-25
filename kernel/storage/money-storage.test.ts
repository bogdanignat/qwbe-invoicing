import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict, ValidationFailure, createInvoicingService } from "../../cubes/invoicing/index.ts"
import { withMigrated } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * Money as PostgreSQL holds it: BIGINT in bani, read back as the two-decimal
 * strings the domain speaks. Each case checks the raw column as well as the
 * value the service returns, so a codec that converted twice, or not at all,
 * cannot pass by symmetry.
 */

const moneyColumns: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["product_presets", ["unit_price"]],
  ["issuers", ["social_capital"]],
  ["invoice_payments", ["amount"]],
  ...["proformas", "issued_invoices", "correction_documents"].map((table) =>
    [table, ["total_excluding_tax", "tax_total", "total_including_tax", "issuer_social_capital"]] as const),
  ...["draft_lines", "issued_lines", "proforma_lines", "correction_lines"].map((table) =>
    [table, ["unit_price", "total_excluding_tax", "tax_amount", "total_including_tax"]] as const),
  ...["issued_tax_breakdown", "proforma_tax_breakdown", "correction_tax_breakdown"].map((table) =>
    [table, ["taxable_amount", "tax_amount"]] as const),
]

const service = (pool: Parameters<typeof createPostgresStore>[0]) => {
  let sequence = 0
  return createInvoicingService({
    context: { current: Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [
      "invoicing:read", "invoicing:settings.manage", "invoicing:invoice.issue",
    ] }, organization: { id: "org-1" } }) },
    ids: { next: Effect.sync(() => `money-${String(++sequence)}`) },
    clock: { now: Effect.succeed(new Date("2026-09-01T10:00:00Z")) },
    branding: { normalize: () => Effect.die("No image in this fixture") },
    store: createPostgresStore(pool), cubeIdentity: "invoicing",
  })
}

const issuer = {
  name: "Exemplu SRL", fiscalIdentifier: "12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl" as const, tradeRegistryNumber: "J22/123/2020", socialCapital: "1000", iban: "", bankName: "",
  defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true as const, effectiveFrom: "2025-08-01" }, branding: null,
}

void test("the 37 money columns are BIGINT, NOT NULL except the social capital; quantities and rates stay TEXT", () =>
  withMigrated("money_columns", async ({ sql }) => {
    const columns = new Map((await sql.query<{ readonly name: string; readonly data_type: string; readonly is_nullable: string }>(
      `SELECT table_name || '.' || column_name AS name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'`,
    )).map(({ name, data_type, is_nullable }) => [name, `${data_type} ${is_nullable}`]))
    const expected = moneyColumns.flatMap(([table, names]) => names.map((name) => `${table}.${name}`))
    assert.equal(expected.length, 37)
    for (const name of expected) assert.equal(columns.get(name), `bigint ${name.endsWith("social_capital") ? "YES" : "NO"}`, name)
    for (const name of ["draft_lines.quantity", "issued_lines.tax_rate", "issued_tax_breakdown.rate", "issuer_tax_configurations.rate"]) {
      assert.equal(columns.get(name), "text NO", name)
    }
  }))

void test("a preset price and the issuer capital are stored in bani, an absent capital as NULL", () =>
  withMigrated("money_settings", async ({ pool, sql }) => {
    const invoicing = service(pool)
    const preset = await Effect.runPromise(invoicing.createProductPreset({
      code: "AUD", kind: "service", description: "Audit", unitPrice: "90071992547409.93", unitOfMeasure: { code: "HUR", name: "oră" },
    }))
    assert.equal(preset.unitPrice, "90071992547409.93")
    assert.equal(await sql.scalar("SELECT unit_price FROM product_presets WHERE id=$1", [preset.id]), "9007199254740993")
    assert.deepEqual((await Effect.runPromise(invoicing.listProductPresets())).items, [preset])

    const capital = async (socialCapital: string, legalForm: "srl" | "pfa" = "srl") => {
      await Effect.runPromise(invoicing.configureIssuer({ ...issuer, legalForm, socialCapital }))
      return { stored: await sql.scalar("SELECT social_capital FROM issuers"), read: (await Effect.runPromise(invoicing.getIssuer())).socialCapital }
    }
    assert.deepEqual(await capital("1000"), { stored: "100000", read: "1000.00" })
    assert.deepEqual(await capital("9999999999999999.99"), { stored: "999999999999999999", read: "9999999999999999.99" })
    assert.deepEqual(await capital("0"), { stored: "0", read: "0.00" })
    assert.deepEqual(await capital("", "pfa"), { stored: null, read: "" })
    // An SRL may save an incomplete profile, and issuance still refuses it.
    assert.deepEqual(await capital(""), { stored: null, read: "" })
    await Effect.runPromise(invoicing.addDocumentSeries({ documentType: "invoice", series: "INV" }))
    const refused = await Effect.runPromise(Effect.flip(invoicing.issueInvoice({
      request: { series: "INV", issueDate: "2026-09-01", dueDate: "2026-09-16", currency: "RON",
        customer: { name: "Client", partyType: "individual", fiscalIdentifier: "", vatRegistered: false, address: issuer.address },
        lines: [{ description: "Audit", quantity: "1", unitPrice: "10", unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD" }] },
      idempotency: { key: "srl-without-capital", fingerprint: `sha256:${"0".repeat(64)}` },
    })))
    assert.ok(refused instanceof ValidationFailure)
    assert.equal(await sql.scalar("SELECT count(*) FROM issued_invoices"), "0")
  }))

void test("an amount past int8 is refused by PostgreSQL as a conflict and rolls the transaction back", () =>
  withMigrated("money_overflow", async ({ pool, sql }) => {
    const store = createPostgresStore(pool)
    const preset = { id: "kept", organizationId: "org-1", code: "AUD", kind: "service" as const, description: "Audit", unitPrice: "10.00", unitOfMeasure: { code: "C62", name: "unitate" } }
    const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) => Effect.gen(function*() {
      yield* transaction.saveProductPreset(preset)
      yield* transaction.saveProductPreset({ ...preset, id: "huge", code: "HUGE", unitPrice: "92233720368547758.08" })
    }))))
    assert.ok(failure instanceof DomainConflict && failure.code === "persistence_conflict", String(failure))
    assert.equal(await sql.scalar("SELECT count(*) FROM product_presets"), "0")
    // The refusal is the engine's own: 22003, one past the int8 maximum.
    const raw = await sql.rejects(`INSERT INTO product_presets(id,organization_id,code,kind,description,unit_price,unit_code,unit_name)
      VALUES('raw','org-1','RAW','service','Audit',$1,'C62','unitate')`, ["9223372036854775808"])
    assert.equal(raw.code, "22003")
    // The largest value does fit, and comes back exactly.
    await Effect.runPromise(store.transaction((transaction) =>
      transaction.saveProductPreset({ ...preset, unitPrice: "92233720368547758.07" })))
    assert.equal((await Effect.runPromise(store.transaction((transaction) =>
      transaction.findProductPreset("org-1", "kept"))))?.unitPrice, "92233720368547758.07")
  }))
