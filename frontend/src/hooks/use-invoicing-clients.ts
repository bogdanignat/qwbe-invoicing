import { useMemo } from "react"

import { useAuth } from "./auth-context.ts"
import { createInvoiceDocumentsClient, createInvoiceRegisterClient } from "../lib/invoicing-clients.ts"
import type { InvoiceDocumentsClient, InvoiceRegisterClient } from "../lib/invoicing-clients.ts"

/**
 * The single place where the session's transport becomes a data client.
 *
 * Every data hook goes through here instead of importing a client, so there is
 * exactly one edge between "which session am I" and "how do I ask": the clients
 * are rebuilt only if the transport itself is replaced, and no module holds a
 * transport of its own that could outlive a session.
 */
export interface InvoicingClients {
  readonly register: InvoiceRegisterClient
  readonly documents: InvoiceDocumentsClient
}

export const useInvoicingClients = (): InvoicingClients => {
  const { transport } = useAuth()
  return useMemo(() => ({
    register: createInvoiceRegisterClient(transport),
    documents: createInvoiceDocumentsClient(transport),
  }), [transport])
}
