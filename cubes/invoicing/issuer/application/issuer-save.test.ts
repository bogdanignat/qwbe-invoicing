import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import {
  brandingNormalizer, contextProvider, each, emptyState, fixedClock, identity, idempotent, memoryStore, sequentialIds,
} from "../../application/memory-store.test-support.ts"
import { DomainConflict, PermissionDenied, ValidationFailure } from "../../contracts/failures.ts"
import { issuerSaveConflicts, VatRegistryUnavailable, type VatRegistry, type VatRegistryStatus } from "../contracts/fiscal-guard.ts"
import type { ConfigureIssuerInput, VatChange } from "../domain/issuer.ts"

// `fixedClock` is 2026-09-01 in Bucharest: "today" for every check below.
const today = "2026-09-01"
const registered = (effectiveFrom: string): VatChange => ({ registered: true, effectiveFrom })
const nonVat = (effectiveFrom: string): VatChange => ({ registered: false, effectiveFrom, nonVatBasis: "article_310" })
const input = (vatChange: VatChange, fiscalIdentifier = "12345674"): ConfigureIssuerInput => ({
  name: "Emitent SRL", fiscalIdentifier, address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" },
  legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
  branding: null, defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange,
})
const invoice = (issueDate: string) => idempotent({
  customer: { partyType: "individual" as const, name: "Client", fiscalIdentifier: "", vatRegistered: false,
    address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } },
  series: "INV", issueDate, dueDate: "2026-09-30", currency: "RON" as const,
  lines: [{ description: "Serviciu", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }],
})

type Answer = VatRegistryStatus | "unavailable"
/** A registry that answers from `answer`, which a test may swap, and remembers every question. */
const setup = (options: { readonly registry?: boolean; readonly permissions?: ReadonlyArray<string> } = {}) => {
  const state = emptyState()
  const asked: Array<readonly [string, string]> = []
  let answer: (cif: string, date: string) => Answer = () => "registered"
  let during: () => void = () => undefined
  const registry: VatRegistry = { statusOn: (cif, date) => Effect.suspend(() => {
    asked.push([cif, date])
    during()
    const status = answer(cif, date)
    return status === "unavailable" ? Effect.fail(new VatRegistryUnavailable()) : Effect.succeed(status)
  }) }
  const service = createInvoicingService({
    context: contextProvider({ identity: { ...identity, permissions: [...options.permissions ?? identity.permissions] }, organization: { id: "org-1" } }),
    clock: fixedClock, ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer,
    vatRegistry: options.registry === false ? undefined : registry, cubeIdentity: "invoicing",
  })
  const configure = (value: ConfigureIssuerInput) => Effect.runPromise(service.configureIssuer(value))
  const refused = (value: ConfigureIssuerInput) => Effect.runPromise(Effect.flip(service.configureIssuer(value)))
  return {
    state, service, asked, configure, refused,
    answer: (next: typeof answer) => { answer = next },
    during: (next: typeof during) => { during = next },
    lastReason: () => state.auditEvents.at(-1)?.reason,
  }
}

const expectIssue = (failure: unknown, pattern: RegExp) => {
  assert.ok(failure instanceof ValidationFailure, String(failure))
  assert.match(failure.issues.join(" "), pattern)
}
const expectConflict = (failure: unknown, code: string, message?: string) => {
  assert.ok(failure instanceof DomainConflict, JSON.stringify(failure))
  assert.equal(failure.code, code, message)
}

void test("a fiscal change is saved when ANAF agrees on the day it starts and today, and the audit says it was checked", async () => {
  const rig = setup()
  const saved = await rig.configure(input(registered("2025-08-01")))
  assert.deepEqual(saved.warnings, [])
  assert.deepEqual(rig.asked, [["12345674", "2025-08-01"], ["12345674", today]])
  assert.equal(rig.lastReason(), "vat_registry:checked")
})

void test("ANAF contradicting the regime on either day, or not knowing the CIF, refuses the save and writes nothing", async () => {
  const fresh = setup()
  fresh.answer(() => "not_registered")
  expectIssue(await fresh.refused(input(registered("2025-08-01"))), /nu este înregistrat în scopuri de TVA la 2025-08-01/u)
  assert.equal(fresh.state.issuers.size, 0)

  const rig = setup()
  await rig.configure(input(registered("2025-08-01")))
  const before = structuredClone({ issuers: rig.state.issuers, audit: rig.state.auditEvents })
  rig.answer(() => "registered")
  expectIssue(await rig.refused(input(nonVat("2026-01-01"))), /este înregistrat în scopuri de TVA la 2026-01-01.*art\. 310/u)
  rig.asked.length = 0
  rig.answer((_cif, date) => date < today ? "not_registered" : "registered")
  expectIssue(await rig.refused(input(nonVat("2026-01-01"))), new RegExp(`la ${today}`, "u"))
  assert.deepEqual(rig.asked, [["12345674", "2026-01-01"], ["12345674", today]], "the start agreed, today did not")
  rig.answer(() => "unknown_cif")
  expectIssue(await rig.refused(input(nonVat("2026-01-01"))), /nu figurează în registrul ANAF/u)
  expectIssue(await rig.refused(input(registered("2025-08-01"), "87654329")), /CIF-ul 87654329 nu figurează/u)
  assert.deepEqual({ issuers: rig.state.issuers, audit: rig.state.auditEvents }, before)
})

void test("ANAF unavailable refuses a fiscal change, to be tried later, and writes nothing", async () => {
  const rig = setup()
  rig.answer(() => "unavailable")
  assert.ok(await rig.refused(input(registered("2025-08-01"))) instanceof VatRegistryUnavailable)
  assert.equal(rig.state.issuers.size, 0)
  assert.equal(rig.state.auditEvents.length, 0)
})

void test("without the registry (plugin off) a fiscal change is saved with a warning, audited as not checked", async () => {
  const rig = setup({ registry: false })
  assert.deepEqual((await rig.configure(input(registered("2025-08-01")))).warnings, ["vat_registry_not_checked"])
  assert.equal(rig.lastReason(), "vat_registry:not_checked")
  assert.deepEqual((await rig.configure({ ...input(registered("2025-08-01")), name: "Alt nume SRL" })).warnings, [])
  assert.equal(rig.lastReason(), "vat_registry:not_needed")
})

void test("a save that changes nothing fiscal never asks the registry, and works while ANAF is down", async () => {
  const rig = setup()
  await rig.configure(input(registered("2025-08-01")))
  rig.asked.length = 0
  rig.answer(() => "unavailable")
  const saved = await rig.configure({ ...input(registered("2026-01-01")), name: "Alt nume SRL", iban: "RO49AAAA1B31007593840000",
    address: { countryCode: "RO", city: "Cluj-Napoca", street: "Strada 3", county: "RO-CJ" } })
  assert.equal(saved.name, "Alt nume SRL")
  assert.deepEqual(saved.warnings, [])
  assert.deepEqual(rig.asked, [])
  assert.equal(rig.lastReason(), "vat_registry:not_needed")
})

void test("authorization comes before any question to the registry", async () => {
  const rig = setup({ permissions: identity.permissions.filter((permission) => permission !== "invoicing:settings.manage") })
  assert.ok(await rig.refused(input(registered("2025-08-01"))) instanceof PermissionDenied)
  assert.deepEqual(rig.asked, [])
})

void test("issued invoices and stornos refuse a regime change that starts on or before their date", async () => {
  const rig = setup()
  await rig.configure(input(registered("2025-08-01")))
  await Effect.runPromise(rig.service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  const issued = await Effect.runPromise(rig.service.issueInvoice(invoice("2026-08-20")))
  await Effect.runPromise(rig.service.createCorrection(idempotent({ originalInvoiceId: issued.id, reason: "Storno" })))
  rig.answer(() => "not_registered")
  for (const effectiveFrom of ["2026-08-20", "2026-08-25", today]) {
    expectConflict(await rig.refused(input(nonVat(effectiveFrom))), issuerSaveConflicts.issuedDocuments)
  }
  const later = await rig.configure(input(nonVat("2026-09-02")))
  assert.equal(later.vatConfigurations.at(-1)?.effectiveFrom, "2026-09-02", "every document is dated before the change")
})

void test("a new CIF is checked against ANAF, and refused once any document is issued, whatever its date", async () => {
  const rig = setup()
  await rig.configure(input(registered("2025-08-01")))
  rig.asked.length = 0
  assert.equal((await rig.configure(input(registered("2025-08-01"), "87654329"))).fiscalIdentifier, "87654329")
  assert.deepEqual(rig.asked, [["87654329", today]])
  await Effect.runPromise(rig.service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  await Effect.runPromise(rig.service.issueInvoice(invoice("2026-08-20")))
  expectConflict(await rig.refused(input(registered("2025-08-01"))), issuerSaveConflicts.cifWithDocuments)
  rig.answer(() => "not_registered")
  expectConflict(await rig.refused(input(nonVat("2026-09-02"))), issuerSaveConflicts.cifWithDocuments,
    "a regime change after every document does not excuse the new CIF")
})

void test("a CIF or VAT history that moves while ANAF is asked voids the save with a conflict", async () => {
  const rig = setup()
  await rig.configure(input(registered("2025-08-01")))
  const stored = rig.state.issuers.get("org-1")
  assert.ok(stored)
  rig.answer(() => "not_registered")
  rig.during(() => { rig.state.issuers.set("org-1", { ...stored, fiscalIdentifier: "87654329" }) })
  expectConflict(await rig.refused(input(nonVat("2026-09-02"))), issuerSaveConflicts.concurrentChange)
  assert.equal(rig.state.issuers.get("org-1")?.fiscalIdentifier, "87654329", "the concurrent write stands")
})
