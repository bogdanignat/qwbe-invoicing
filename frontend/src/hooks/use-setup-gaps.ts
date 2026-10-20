import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { companyLookupAvailabilityQuery } from "./company-lookup-queries.ts"
import { efacturaConnectionQuery } from "./efactura-queries.ts"
import { documentSeriesQuery, issuerQuery } from "./reference-queries.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { pluginActive } from "../lib/plugins.ts"
import { setupGaps, type SetupCheck, type SetupGap } from "../lib/setup-gaps.ts"

const checkOf = <Value>(read: UseQueryResult<Value>): SetupCheck<Value> =>
  read.data !== undefined ? { kind: "ready", value: read.data } : read.isError ? { kind: "failed" } : { kind: "pending" }

/**
 * The dashboard's „Configurare incompletă” rows, from the reads the settings
 * screens already make, under the same keys, so the cache is shared and a fix
 * saved there is what this card reads next. A plugin's read is enabled only
 * while the plugin runs: its route is absent otherwise.
 *
 * The provider comes from `availability`, the read the customer forms already
 * make (the lookup permission, no retry), not from the settings read: both
 * answer the same provider, and saving the settings invalidates it.
 */
export const useSetupGaps = (): ReadonlyArray<SetupGap> | undefined => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const enabled = auth.status === "authenticated"
  const companyLookup = pluginActive(auth, "company-lookup")
  const efactura = pluginActive(auth, "efactura")
  const issuer = useQuery(issuerQuery(clients.reference, enabled))
  const series = useQuery(documentSeriesQuery(clients.reference, enabled))
  const provider = useQuery({
    ...companyLookupAvailabilityQuery(clients.companyLookup, companyLookup), select: (availability) => availability.provider,
  })
  const connection = useQuery(efacturaConnectionQuery(clients.efactura, efactura))
  return setupGaps({
    plugins: { companyLookup, efactura },
    issuer: checkOf(issuer),
    series: checkOf(series),
    lookupProvider: checkOf(provider),
    anaf: checkOf(connection),
  })
}
