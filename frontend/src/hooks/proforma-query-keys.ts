import type { QueryKey } from "@tanstack/react-query"

/**
 * The cache keys the proforma screens are read and invalidated by.
 *
 * They live apart from any one hook because a write is followed from wherever
 * it was started: a replay after a reload invalidates the registry and the
 * document it produced without the screens that own them being mounted.
 */
export const proformasQueryKey = ["proformas"] as const

export const proformaQueryKey = (id: string): readonly ["proforma", string] => ["proforma", id] as const

/**
 * What a write against proformas leaves stale.
 *
 * The registry always: a proforma was added, or one stopped being convertible.
 * A conversion additionally stales the proforma it started from — its own
 * screen would otherwise keep offering a conversion that already happened —
 * and that one is only known when the write names it.
 */
export const staleProformaKeys = (sourceProformaId: string | undefined): ReadonlyArray<QueryKey> =>
  sourceProformaId === undefined
    ? [proformasQueryKey]
    : [proformasQueryKey, proformaQueryKey(sourceProformaId)]
