import { useQuery } from "@tanstack/react-query"

import { runUiEffect } from "../lib/api.ts"
import { invoicingClient } from "../lib/invoicing-client.ts"

export const useVatCatalogue = () => useQuery({
  queryKey: ["vat-regimes"],
  queryFn: ({ signal }) => runUiEffect(invoicingClient.getVatCatalogue(), signal),
})
