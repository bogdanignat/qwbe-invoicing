import { Effect } from "effect"

import { VatRegistryUnavailable, type VatRegistry } from "../../cubes/invoicing/issuer/index.ts"
import type { AnafClient } from "./anaf-client.ts"

/**
 * The issuer's VAT registry, read from ANAF's `scpTVA` on the day asked and
 * nothing else of the answer. It asks the shared client directly: the lookup
 * cache is keyed without the day and keeps answers for 24 hours. Any provider
 * failure, the full queue included, is `VatRegistryUnavailable`.
 */
export const anafVatRegistry = (anaf: AnafClient): VatRegistry => ({
  statusOn: (cif, date) => anaf.lookup({ cui: cif }, date).pipe(
    Effect.map((company) => company === undefined ? "unknown_cif" as const
      : company.inregistrare_scop_Tva.scpTVA ? "registered" as const : "not_registered" as const),
    Effect.mapError(() => new VatRegistryUnavailable()),
  ),
})
