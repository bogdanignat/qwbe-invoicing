import { timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"

import { Effect } from "effect"

import {
  AuthenticationRequired,
  OrganizationContextMissing,
  invoicingPermissions,
  type RequestContext,
  type RequestContextProvider,
} from "../cube/invoicing/index.ts"
import type { RuntimeConfig } from "./config.ts"

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
  const permissions = Object.values(invoicingPermissions("invoicing"))

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
          id: "standalone-owner",
          username: "owner",
          roles: ["admin"],
          permissions,
        },
        organization: { id: config.organizationId },
      })
    }),
  })
}
