import { useQuery } from "@tanstack/react-query"

import { runUiEffect } from "./api.ts"
import { invoicingClient } from "./invoicing-client.ts"

export const useVatCatalogue = () => useQuery({
  queryKey: ["vat-regimes"],
  queryFn: ({ signal }) => runUiEffect(invoicingClient.getVatCatalogue(), signal),
})
