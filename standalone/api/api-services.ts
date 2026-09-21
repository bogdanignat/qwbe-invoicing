import { randomUUID } from "node:crypto"

import { Effect } from "effect"

import { createInvoicingService, type RequestContext } from "../../cube/invoicing/index.ts"
import { createPaymentsService } from "../../cube/payments/index.ts"
import { createStandaloneArtifactService } from "../documents/artifact-runtime.ts"
import { createSqlitePaymentsStore, createSqliteStore } from "../storage/sqlite-store.ts"
import { brandingNormalizer } from "./branding-normalizer.ts"
import { CurrentRequest } from "./api-context.ts"
import type { ApiRuntime, ApiServices, UseServices } from "./api-types.ts"

const services = (runtime: ApiRuntime, context: RequestContext): ApiServices => {
  const clock = { now: Effect.sync(runtime.now ?? (() => new Date())) }
  const ids = { next: Effect.sync(randomUUID) }
  const current = { current: Effect.succeed(context) }
  return {
    invoicing: createInvoicingService({ context: current, clock, ids,
      store: createSqliteStore(runtime.dataDirectory), branding: brandingNormalizer, cubeIdentity: "invoicing" }),
    payments: createPaymentsService({ context: current, clock, ids,
      store: createSqlitePaymentsStore(runtime.dataDirectory), cubeIdentity: "payments" }),
    documents: createStandaloneArtifactService(runtime.dataDirectory, Effect.succeed({
      identity: { id: context.identity.id, permissions: context.identity.permissions }, organization: context.organization,
    })),
  }
}

export const createUseServices = (runtime: ApiRuntime): UseServices =>
  (operation) => Effect.flatMap(CurrentRequest, (context) => operation(services(runtime, context)))
