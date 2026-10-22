import { randomUUID } from "node:crypto"

import { Effect } from "effect"

import { createInvoicingService, type RequestContext } from "../../cubes/invoicing/index.ts"
import type { VatRegistry } from "../../cubes/invoicing/issuer/index.ts"
import { createPaymentsService, type PaymentsService } from "../../cubes/invoicing/payments/index.ts"
import { createKernelArtifactService } from "../documents/artifact-runtime.ts"
import { createPostgresPaymentsStore, createPostgresStore } from "../storage/postgres-store.ts"
import { brandingNormalizer } from "./branding-normalizer.ts"
import { CurrentRequest } from "./api-context.ts"
import type { ApiRuntime, ApiServices, UseServices } from "./api-types.ts"

const services = (runtime: ApiRuntime, context: RequestContext, vatRegistry: VatRegistry | undefined): ApiServices => {
  const clock = { now: Effect.sync(runtime.now ?? (() => new Date())) }
  const ids = { next: Effect.sync(randomUUID) }
  const current = { current: Effect.succeed(context) }
  return {
    invoicing: createInvoicingService({ context: current, clock, ids,
      store: createPostgresStore(runtime.pool), branding: brandingNormalizer, vatRegistry, cubeIdentity: "invoicing" }),
    ...(runtime.plugins.payments ? { payments: createPaymentsService({ context: current, clock, ids,
      store: createPostgresPaymentsStore(runtime.pool), cubeIdentity: "payments" }) } : {}),
    documents: createKernelArtifactService(runtime.dataDirectory, runtime.pool, Effect.succeed({
      identity: { id: context.identity.id, permissions: context.identity.permissions }, organization: context.organization,
    })),
  }
}

/**
 * The payments service, for the payments routes. They are mounted only with the
 * plugin on, so a missing service is a composition bug: it fails closed, as a
 * defect (500), and never reaches the payments store.
 */
export const activePayments = (services: ApiServices): PaymentsService => {
  if (services.payments === undefined) throw new Error("the payments plugin is off: its service is not composed")
  return services.payments
}

/**
 * Built once, by `createApiHandler`, and handed to every group, so no service
 * can be composed without the registry. `vatRegistry` is `undefined` exactly
 * when the company-lookup plugin is off.
 */
export const createUseServices = (runtime: ApiRuntime, vatRegistry: VatRegistry | undefined): UseServices =>
  (operation) => Effect.flatMap(CurrentRequest, (context) => operation(services(runtime, context, vatRegistry)))
