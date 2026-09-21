import type { Effect } from "effect"

import type { InvoicingService } from "../../cube/invoicing/index.ts"
import type { ArtifactService } from "../../cube/invoicing/documents/index.ts"
import type { PaymentsService } from "../../cube/payments/index.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import type { BrowserSession } from "../auth/browser-session.ts"
import type { CurrentRequest } from "./api-context.ts"

export interface ApiRuntime {
  readonly authenticate: RequestAuthenticator
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
