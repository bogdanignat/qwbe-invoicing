import type { Effect } from "effect"
import type { Pool } from "pg"

import type { InvoicingService } from "../../cubes/invoicing/index.ts"
import type { ArtifactService } from "../../cubes/invoicing/documents/index.ts"
import type { PaymentsService } from "../../cubes/invoicing/payments/index.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import type { MasterKey } from "../company-lookup/key-cipher.ts"
import type { Transport } from "../outbound/send.ts"
import type { BrowserSession } from "../auth/browser-session.ts"
import type { PluginSelection } from "../plugins.ts"
import type { CurrentRequest } from "./api-context.ts"

export interface ApiRuntime {
  readonly authenticate: RequestAuthenticator
  /**
   * The application pool, owned by whoever built the runtime. The API never
   * creates it and never ends it: `dispose` drains the HTTP handler, not the
   * connections, because a CLI command and the server disagree about when the
   * pool should die.
   */
  readonly pool: Pool
  /** Still a filesystem concern: rendered PDFs are content-addressed files. */
  readonly dataDirectory: string
  readonly now?: () => Date
  readonly browserSession?: BrowserSession
  /** The optional plugins this installation runs; `RuntimeConfig.plugins` in production. */
  readonly plugins: PluginSelection
  /** `RuntimeConfig.companyLookupKey`: without it the openapi.ro key cannot be stored. */
  readonly companyLookupKey?: MasterKey | undefined
  /** Outbound HTTP to the company-lookup providers: `fetch` unless a test hands in a fake. */
  readonly transport?: Transport
}
export interface ApiServices {
  readonly invoicing: InvoicingService
  /** Absent when the payments plugin is off: nothing else composes it. */
  readonly payments?: PaymentsService
  readonly documents: ArtifactService
}
export interface UseServices {
  <A, E>(operation: (services: ApiServices) => Effect.Effect<A, E>): Effect.Effect<A, E, CurrentRequest>
}
