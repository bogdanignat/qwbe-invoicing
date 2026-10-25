import { Effect } from "effect"
import type { Pool } from "pg"

import { createInvoicingService, invoicingPermissions, type InvoicingDependencies, type InvoicingService } from "../../cubes/invoicing/index.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * An invoicing service on a migrated PostgreSQL database, with a clock the test
 * moves: every helper issues on the date it is given, so a case can cross
 * 31 December into a new year.
 */

const permissions = invoicingPermissions("invoicing")
const unit = { code: "C62", name: "unitate" } as const
const lines = [{ description: "Servicii", quantity: "1", unitPrice: "10", unitOfMeasure: unit, vatRateCode: "RO_STANDARD" }]
const customer = {
  partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" },
}
const issuer = {
  name: "Exemplu SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" }, legalForm: "srl" as const,
  tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
  defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true as const, effectiveFrom: "2025-08-01" }, branding: null,
}

let keys = 0
/** A fresh idempotency key per call unless one is given; the fingerprint is fixed, so a reused key replays. */
export const once = <Request>(request: Request, key = `numbering-${String(++keys)}`) =>
  ({ request, idempotency: { key, fingerprint: `sha256:${"0".repeat(64)}` } })

export const run = <Value, Failure>(effect: Effect.Effect<Value, Failure>): Promise<Value> => Effect.runPromise(effect)
export const failure = <Value, Failure>(effect: Effect.Effect<Value, Failure>): Promise<Failure> =>
  Effect.runPromise(Effect.flip(effect))

/**
 * Series FCT and FCT2027 for invoices and FCT for proformas: the same name on both types, so the
 * cases can show the two counters stay apart. Ids carry the organization, as they are global keys.
 */
export const numberingService = async (pool: Pool, organizationId = "org-1") => {
  let now = new Date("2026-12-31T10:00:00.000Z")
  let id = 0
  const serviceOn = (store: InvoicingDependencies["store"]): InvoicingService => createInvoicingService({
    context: { current: Effect.succeed({
      identity: { id: "u", username: "u", roles: ["admin"], permissions: Object.values(permissions) },
      organization: { id: organizationId },
    }) },
    clock: { now: Effect.sync(() => now) },
    ids: { next: Effect.sync(() => `${organizationId}-${String(++id)}`) },
    store, branding: { normalize: () => Effect.die("not expected") }, cubeIdentity: "invoicing",
  })
  const service = serviceOn(createPostgresStore(pool))
  await run(service.configureIssuer(issuer))
  for (const series of ["FCT", "FCT2027"]) await run(service.addDocumentSeries({ documentType: "invoice", series }))
  await run(service.addDocumentSeries({ documentType: "proforma", series: "FCT" }))

  const on = (issueDate: string) => { now = new Date(`${issueDate}T10:00:00.000Z`) }
  const document = (issueDate: string) => ({ customer, issueDate, dueDate: issueDate, currency: "RON" as const, lines })
  const invoiceRequest = (issueDate: string, series = "FCT") => ({ ...document(issueDate), series })
  return {
    service, serviceOn, on, invoiceRequest,
    invoice: (issueDate: string, series = "FCT") => { on(issueDate); return service.issueInvoice(once(invoiceRequest(issueDate, series))) },
    fromDraft: (issueDate: string) => Effect.gen(function*() {
      on(issueDate)
      const draft = yield* service.createDraft(once(invoiceRequest(issueDate)))
      return yield* service.issueInvoice(once({ draftId: draft.id }))
    }),
    proforma: (issueDate: string) => { on(issueDate); return service.issueProforma(once({ ...document(issueDate), proformaSeries: "FCT" })) },
    convert: (proformaId: string, issueDate: string) => { on(issueDate); return service.issueInvoiceFromProforma(once({ proformaId, invoiceSeries: "FCT" })) },
    storno: (originalInvoiceId: string, issueDate: string) => {
      on(issueDate)
      return service.createCorrection(once({ originalInvoiceId, reason: "Storno", issueDate }))
    },
  }
}
