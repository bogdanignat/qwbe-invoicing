import type { Redacted } from "effect"

import { DomainConflict } from "../../../cubes/invoicing/index.ts"
import { tokenAssociatedData, type AnafEnvironment, type TokenKind } from "../../../cubes/invoicing/efactura/connection/index.ts"
import { openText, sealText } from "../../crypto/sealed-text.ts"
import type { AnafClient } from "./config.ts"

/**
 * The ANAF tokens at rest: each sealed under its kind, the organization, the
 * configured environment and client, and the row's generation. Without a
 * client, or under another one, environment or generation, nothing opens.
 */
export const tokenCipher = (client: AnafClient | undefined, environment: AnafEnvironment) => {
  const binding = (organizationId: string, generation: number, kind: TokenKind) =>
    tokenAssociatedData({ kind, organizationId, environment, clientId: client?.clientId ?? "", generation })
  return {
    seal: (organizationId: string, generation: number, kind: TokenKind, plain: Redacted.Redacted): string => {
      if (client === undefined) throw new DomainConflict({ code: "efactura_not_configured", message: "ANAF e-Factura is not configured" })
      return sealText(client.tokenKey, binding(organizationId, generation, kind), plain)
    },
    open: (organizationId: string, generation: number, kind: TokenKind, sealed: string): Redacted.Redacted | undefined =>
      client === undefined ? undefined : openText(client.tokenKey, binding(organizationId, generation, kind), sealed),
  }
}

export type TokenCipher = ReturnType<typeof tokenCipher>
