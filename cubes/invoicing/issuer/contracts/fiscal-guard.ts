import { Data, type Effect } from "effect"

/** What the public VAT registry says about a CIF on one day. */
export type VatRegistryStatus = "registered" | "not_registered" | "unknown_cif"

/** The registry did not answer usably (an error, a timeout, a full queue): asking later may work. */
export class VatRegistryUnavailable extends Data.TaggedError("VatRegistryUnavailable") {}

/**
 * The public VAT registry (ANAF's `scpTVA`), as the issuer asks it before a
 * fiscal change is saved. The host provides it only when the company-lookup
 * plugin runs: an absent registry means exactly that plugin is off, never a
 * missing key or a failed answer, which are `VatRegistryUnavailable`.
 */
export interface VatRegistry {
  readonly statusOn: (cif: string, date: string) => Effect.Effect<VatRegistryStatus, VatRegistryUnavailable>
}

/**
 * The conflicts a fiscal issuer change answers with. Any other conflict on that
 * write comes from the store and is a server fault, so the host keeps it a 500.
 */
export const issuerSaveConflicts = {
  issuedDocuments: "vat_change_affects_issued_documents",
  cifWithDocuments: "fiscal_identifier_change_has_issued_documents",
  concurrentChange: "issuer_changed_concurrently",
} as const
