import type { Effect } from "effect"
import type { Pool } from "pg"

import type { InvoicingService } from "../../cube/invoicing/index.ts"
import type { ArtifactService } from "../../cube/invoicing/documents/index.ts"
import type { PaymentsService } from "../../cube/payments/index.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import type { BrowserSession } from "../auth/browser-session.ts"
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
}
export interface ApiServices {
  readonly invoicing: InvoicingService
  readonly payments: PaymentsService
  readonly documents: ArtifactService
}
export interface UseServices {
  <A, E>(operation: (services: ApiServices) => Effect.Effect<A, E>): Effect.Effect<A, E, CurrentRequest>
}
