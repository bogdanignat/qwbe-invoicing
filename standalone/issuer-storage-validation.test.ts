import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { Effect } from "effect"
import { createInvoicingService, PersistenceFailure, type InvoicingFailure } from "../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

void test("strict issuer reads refuse corrupt or noncanonical profile, invoice, proforma and correction fields", async () => {
  const directory = mkdtempSync(join(tmpdir(), "issuer-corruption-"))
  try {
    applyMigrations(directory)
    let sequence = 0
    const service = createInvoicingService({
      context: { current: Effect.succeed({ identity: { id: "test", username: "test", roles: ["admin"], permissions: [
        "invoicing:read", "invoicing:settings.manage", "invoicing:invoice.issue", "invoicing:proforma.issue", "invoicing:invoice.void",
      ] }, organization: { id: "test" } }) },
      ids: { next: Effect.sync(() => `id-${String(++sequence)}`) },
      clock: { now: Effect.succeed(new Date("2026-09-01T10:00:00Z")) },
      branding: { normalize: () => Effect.die("No image in this fixture") },
      store: createSqliteStore(directory), cubeIdentity: "invoicing",
    })
    const profile = { name: "Test SRL", fiscalIdentifier: "RO12345674", address: { countryCode: "RO", city: "Iași", street: "Test 1" },
      legalForm: "srl" as const, tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", bankName: "Banca Test", iban: "RO49AAAA1B31007593840000",
      branding: null, defaultCurrency: "RON", defaultPaymentTermDays: 15,
      vatChange: { registered: true, effectiveFrom: "2025-08-01" },
    }
    await Effect.runPromise(service.configureIssuer(profile))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "proforma", series: "PRO" }))
    const request = { series: "INV", issueDate: "2026-09-01", currency: "RON" as const,
      customer: { name: "Client", partyType: "individual" as const, fiscalIdentifier: "", address: profile.address },
      lines: [{ description: "Service", quantity: "1", unitPrice: "10", unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD" }],
    }
    const attempt = <Value>(value: Value) => ({ request: value, idempotency: { key: `attempt-${String(++sequence)}`, fingerprint: `sha256:${"0".repeat(64)}` } })
    const invoice = await Effect.runPromise(service.issueInvoice(attempt(request)))
    const proforma = await Effect.runPromise(service.issueProforma(attempt({ ...request, proformaSeries: "PRO" })))
    const correction = await Effect.runPromise(service.createCorrection(attempt({ originalInvoiceId: invoice.id, reason: "Test" })))
    const cases: { table: string; prefix: string; reads: (() => Effect.Effect<unknown, InvoicingFailure>)[] }[] = [
      { table: "issuers", prefix: "", reads: [() => service.getIssuer()] },
      { table: "issued_invoices", prefix: "issuer_", reads: [() => service.getIssuedInvoice(invoice.id), () => service.listIssuedInvoices()] },
      { table: "proformas", prefix: "issuer_", reads: [() => service.getProforma(proforma.id), () => service.listProformas()] },
      { table: "correction_documents", prefix: "issuer_", reads: [() => service.getCorrection(correction.id), () => service.listCorrections(invoice.id)] },
    ]
    for (const { table, prefix, reads } of cases) {
      const database = new DatabaseSync(databasePath(directory))
      try {
        if (prefix !== "") assert.throws(() => { database.exec(`UPDATE ${table} SET ${prefix}bank_name='Changed'`) })
        // Simulate offline corruption only in this disposable database. Normal
        // runtime immutability is checked above before removing its triggers.
        const triggers = database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table)
        for (const trigger of triggers) {
          assert.equal(typeof trigger.name, "string")
          database.exec(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`)
        }
        database.exec("PRAGMA ignore_check_constraints=ON")
        const mutations = [
          ["legal_form", "SRL"], ["trade_registry_number", "BAD"], ["trade_registry_number", " j40/123/2020 "],
          ["social_capital", "1.001"], ["social_capital", "200"], ["iban", "RO00INVALID"],
          ["iban", "ro49aaaa1b31007593840000"], ["bank_name", "Bank\u200bName"], ["bank_name", " Bank "],
          ...(prefix === "" ? [] : [["trade_registry_number", ""], ["social_capital", ""]]),
        ]
        for (const [field, value] of mutations) {
          try {
            database.prepare(`UPDATE ${table} SET ${prefix}${String(field)}=?`).run(String(value))
            for (const read of reads) {
              const result = await Effect.runPromise(Effect.either(read()))
              assert.equal(result._tag, "Left", `${table}.${String(field)}=${String(value)}`)
              assert.ok(result.left instanceof PersistenceFailure)
            }
          } finally {
            const original = ({ legal_form: profile.legalForm, trade_registry_number: profile.tradeRegistryNumber,
              social_capital: profile.socialCapital, iban: profile.iban, bank_name: profile.bankName } as Record<string, string>)[String(field)]
            database.prepare(`UPDATE ${table} SET ${prefix}${String(field)}=?`).run(original ?? "")
          }
        }
      } finally { database.close() }
    }
    // Incomplete profiles are legitimate, unlike incomplete issued snapshots.
    await Effect.runPromise(service.configureIssuer({ ...profile, tradeRegistryNumber: "", socialCapital: "" }))
    assert.equal((await Effect.runPromise(service.getIssuer())).socialCapital, "")
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
