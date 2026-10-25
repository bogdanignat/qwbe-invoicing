import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { draftBuyerToRead } from "../lib/invoice-authoring-opening.ts"
import type { Customer, DraftInvoice } from "../lib/draft-models.ts"

export interface DraftBuyerRead {
  readonly pending: boolean
  /** Absent when no read was needed or it failed: the proposal then takes the issuer's term. */
  readonly buyer: Customer | undefined
}

/**
 * The saved buyer of a draft opened without a due date, read by id so its
 * payment term is known even when the paged registry has not reached it. The
 * id is fixed when the screen opens: a later save changes the draft, never what
 * the form was opened with, so this never holds the form back a second time.
 */
export const useDraftBuyer = (initialDraft: DraftInvoice | undefined): DraftBuyerRead => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const [customerId] = useState(() => draftBuyerToRead(initialDraft))
  const query = useQuery({
    queryKey: ["customers", "by-id", customerId ?? ""],
    enabled: status === "authenticated" && customerId !== undefined,
    queryFn: ({ signal }) => customerId === undefined
      ? Promise.reject(new Error("Draftul nu are un client salvat."))
      : clients.reference.getCustomer(customerId, signal),
  })
  return { pending: query.isLoading, buyer: query.data }
}
