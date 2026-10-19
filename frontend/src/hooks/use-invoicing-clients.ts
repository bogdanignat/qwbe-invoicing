import { useMemo } from "react"

import { useAuth } from "./auth-context.ts"
import {
  createInvoiceDocumentsClient, createInvoiceRegisterClient,
} from "../lib/invoicing-clients.ts"
import type { InvoiceDocumentsClient, InvoiceRegisterClient } from "../lib/invoicing-clients.ts"
import { createDraftsClient } from "../lib/drafts-client.ts"
import type { DraftsClient } from "../lib/drafts-client.ts"
import { createAuthoringReferenceClient } from "../lib/authoring-reference-client.ts"
import type { AuthoringReferenceClient } from "../lib/authoring-reference-client.ts"
import { createCompanyLookupClient } from "../lib/company-lookup-client.ts"
import type { CompanyLookupClient } from "../lib/company-lookup-client.ts"
import { createEFacturaClient } from "../lib/efactura-client.ts"
import type { EFacturaClient } from "../lib/efactura-client.ts"
import { createPaymentsClient } from "../lib/payments-client.ts"
import type { PaymentsClient } from "../lib/payments-client.ts"
import { createProformaReplayClient } from "../lib/proforma-replay-client.ts"
import type { ProformaReplayClient } from "../lib/proforma-replay-client.ts"
import { createProformasClient } from "../lib/proformas-client.ts"
import type { ProformasClient } from "../lib/proformas-client.ts"
import { createRegistryClient } from "../lib/registry-client.ts"
import { createReportsClient } from "../lib/reports-client.ts"
import type { ReportsClient } from "../lib/reports-client.ts"
import type { RegistryClient } from "../lib/registry-client.ts"
import { createSettingsClient } from "../lib/settings-client.ts"
import type { SettingsClient } from "../lib/settings-client.ts"

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
  readonly drafts: DraftsClient
  readonly reference: AuthoringReferenceClient
  /** The master-data writes; `reference` stays read-only on purpose. */
  readonly registry: RegistryClient
  readonly proformas: ProformasClient
  /** The same three writes with an opaque body: resending an intent written down before the first attempt. */
  readonly proformaReplay: ProformaReplayClient
  /** The settings screen's writes: the issuer profile and one new document series. */
  readonly settings: SettingsClient
  /** An issued invoice's payment ledger: the summary and its two writes. */
  readonly payments: PaymentsClient
  /** The dashboard's revenue and collections reports. */
  readonly reports: ReportsClient
  /** The company-lookup plugin's routes; only a caller that checked the session's plugins asks them. */
  readonly companyLookup: CompanyLookupClient
  /** The e-Factura plugin's routes; only a caller that checked the session's plugins asks them. */
  readonly efactura: EFacturaClient
}

export const useInvoicingClients = (): InvoicingClients => {
  const { transport } = useAuth()
  return useMemo(() => ({
    register: createInvoiceRegisterClient(transport),
    documents: createInvoiceDocumentsClient(transport),
    drafts: createDraftsClient(transport),
    reference: createAuthoringReferenceClient(transport),
    registry: createRegistryClient(transport),
    proformas: createProformasClient(transport),
    proformaReplay: createProformaReplayClient(transport),
    settings: createSettingsClient(transport),
    payments: createPaymentsClient(transport),
    reports: createReportsClient(transport),
    companyLookup: createCompanyLookupClient(transport),
    efactura: createEFacturaClient(transport),
  }), [transport])
}
