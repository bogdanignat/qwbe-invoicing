import { Effect } from "effect"

import { checked, recordAuditEvent, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingTransaction } from "../../application/ports.ts"
import { DomainConflict, ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { RequestContext } from "../../contracts/host.ts"
import { issuerSaveConflicts, type VatRegistry, type VatRegistryUnavailable } from "../contracts/fiscal-guard.ts"
import {
  fiscalChangeOf, registryChecks, registryIssue, sameFiscalState, type FiscalChange, type RegistryCheck,
} from "../domain/fiscal-change.ts"
import type { IssuerProfile, VatChange } from "../domain/issuer.ts"
import { validateIssuer } from "../domain/validation.ts"
import { scheduleVatRegistration } from "../domain/vat-regime.ts"
import { issuerDate, issuerView, type ConfiguredIssuer } from "./issuer-view.ts"
import type { IssuerTransaction } from "./ports.ts"

export interface IssuerSaveDependencies extends OperationDependencies<InvoicingTransaction & IssuerTransaction> {
  /** Absent only when the company-lookup plugin is off: a fiscal change is then saved unchecked, with a warning. */
  readonly vatRegistry?: VatRegistry | undefined
}

type Verification = "checked" | "not_checked" | "not_needed"

const conflict = (code: string, message: string) => Effect.fail(new DomainConflict({ code, message }))

/** Every check asked in turn; the first answer that disagrees refuses the save. */
const verify = (
  registry: VatRegistry | undefined, cif: string, checks: ReadonlyArray<RegistryCheck>,
): Effect.Effect<Verification, ValidationFailure | VatRegistryUnavailable> => {
  if (checks.length === 0) return Effect.succeed("not_needed")
  if (registry === undefined) return Effect.succeed("not_checked")
  return Effect.forEach(checks, (check) => Effect.flatMap(registry.statusOn(cif, check.date), (status) => {
    const issue = registryIssue(cif, check, status)
    return issue === undefined ? Effect.void : Effect.fail(new ValidationFailure({ issues: [issue] }))
  }), { discard: true }).pipe(Effect.as("checked" as const))
}

/** A new CIF counts every document ever issued; a new regime, those dated on or after the day it starts. */
const touchesIssuedDocuments = (transaction: IssuerTransaction, organizationId: string, fiscal: FiscalChange) =>
  fiscal.cifChanged ? transaction.hasIssuedDocuments(organizationId)
    : fiscal.regimeFrom === undefined ? Effect.succeed(false)
      : transaction.hasIssuedDocuments(organizationId, fiscal.regimeFrom)

/**
 * The profile is read in a short transaction, the registry is asked outside any
 * transaction (a network call never holds the business lock), and the final
 * transaction reads the CIF and the VAT history again: if they moved in between,
 * the decision taken on them is void. The issued-documents check runs in that
 * final transaction, under the lock issuance takes too, so an invoice issued
 * concurrently is either seen here or issued after the new regime is saved.
 */
export const saveIssuerProfile = (
  dependencies: IssuerSaveDependencies, context: RequestContext, now: Date,
  profile: Omit<IssuerProfile, "vatConfigurations">, change: VatChange,
): Effect.Effect<ConfiguredIssuer, InvoicingFailure | VatRegistryUnavailable> => Effect.gen(function*() {
  const organizationId = context.organization.id
  const before = yield* dependencies.store.transaction((transaction) => transaction.findIssuer(organizationId))
  const vatConfigurations = yield* checked(() => scheduleVatRegistration(before?.vatConfigurations ?? [], change))
  const configured: IssuerProfile = { ...profile, vatConfigurations }
  yield* checked(() => { validateIssuer(configured) })
  const fiscal = fiscalChangeOf(before, profile.fiscalIdentifier, change)
  const checks = yield* checked(() => registryChecks(fiscal, vatConfigurations, change, issuerDate(now)))
  const verification = yield* verify(dependencies.vatRegistry, profile.fiscalIdentifier, checks)
  return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
    if (!sameFiscalState(before, yield* transaction.findIssuer(organizationId))) {
      return yield* conflict(issuerSaveConflicts.concurrentChange, "issuer CIF or VAT history changed while the save was being checked")
    }
    if (yield* touchesIssuedDocuments(transaction, organizationId, fiscal)) {
      return yield* fiscal.cifChanged
        ? conflict(issuerSaveConflicts.cifWithDocuments, "the CIF cannot change once a document is issued")
        : conflict(issuerSaveConflicts.issuedDocuments, "documents are already issued in the period the VAT change rewrites")
    }
    yield* transaction.saveIssuer(configured)
    yield* recordAuditEvent(transaction, context, dependencies.ids, now, {
      action: "issuer.configured", targetKind: "issuer", targetId: organizationId,
      reason: `vat_registry:${verification}`,
    })
    return { ...issuerView(configured, now), warnings: verification === "not_checked" ? ["vat_registry_not_checked" as const] : [] }
  }))
})
