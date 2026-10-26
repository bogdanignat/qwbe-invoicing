import { timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"

import { Effect } from "effect"

import {
  AuthenticationRequired,
  OrganizationContextMissing,
  invoicingPermissions,
  type RequestContext,
  type RequestContextProvider,
} from "../../cubes/invoicing/index.ts"
import { companyLookupPermission } from "../../cubes/invoicing/company-lookup/index.ts"
import { documentsPermissions } from "../../cubes/invoicing/documents/index.ts"
import { efacturaPermissions } from "../../cubes/invoicing/efactura/connection/index.ts"
import { paymentsPermissions } from "../../cubes/invoicing/payments/index.ts"
import type { RuntimeConfig } from "../config.ts"

/**
 * The one reading of an `Authorization` header: exactly `Bearer <token>`, or
 * nothing. Any other scheme or spelling (`bearer`, `BEARER`, `Basic`) is not a
 * credential, and the caller that sent it is refused like a wrong token.
 */
const bearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return undefined
  const token = authorization.slice("Bearer ".length).trim()
  return token.length > 0 ? token : undefined
}

const matches = (actual: string, expected: string): boolean => {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export type RequestAuthenticator = (authorization: string | undefined) => RequestContextProvider

export const createRequestAuthenticator = (config: RuntimeConfig): RequestAuthenticator => {
  const configuredToken = config.authTokenFile === undefined
    ? undefined
    : readFileSync(config.authTokenFile, "utf8").trim()
  if (configuredToken !== undefined && configuredToken.length < 32) {
    throw new Error("AUTH_TOKEN_FILE must contain at least 32 characters")
  }
  const invoicing = invoicingPermissions("invoicing")
  const payments = paymentsPermissions("payments")
  const efactura = efacturaPermissions("efactura")
  // A plugin's grants exist only with the plugin on. `invoicing:read` stays
  // regardless: it is the invoicing base permission, and the alias the payments
  // cube still accepts for reading.
  const permissions = [
    invoicing.read,
    invoicing.manageCustomers,
    invoicing.draftInvoices,
    invoicing.issueInvoices,
    invoicing.issueProformas,
    invoicing.voidInvoices,
    invoicing.manageSettings,
    ...(config.plugins.payments ? [payments.read, payments.record] : []),
    ...(config.plugins.efactura ? [efactura.read, efactura.manageConnection, efactura.submit, efactura.reconcile, efactura.receive] : []),
    ...(config.plugins["company-lookup"] ? [companyLookupPermission("company-lookup")] : []),
    documentsPermissions.read,
    documentsPermissions.render,
  ]

  return (authorization) => ({
    current: Effect.suspend((): Effect.Effect<
      RequestContext,
      AuthenticationRequired | OrganizationContextMissing
    > => {
      const suppliedToken = bearerToken(authorization)
      if (configuredToken === undefined || suppliedToken === undefined || !matches(suppliedToken, configuredToken)) {
        return Effect.fail(new AuthenticationRequired())
      }
      if (config.organizationId === undefined || config.organizationId.trim().length === 0) {
        return Effect.fail(new OrganizationContextMissing())
      }
      return Effect.succeed({
        identity: {
          id: "kernel-owner",
          username: "owner",
          roles: ["admin"],
          permissions,
        },
        organization: { id: config.organizationId },
      })
    }),
  })
}
