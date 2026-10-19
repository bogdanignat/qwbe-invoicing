import type { Redacted } from "effect"

import { openText, sealText, type MasterKey } from "../crypto/sealed-text.ts"

/**
 * The openapi.ro key at rest, under the master key from `COMPANY_LOOKUP_KEY_FILE`
 * (`kernel/crypto/sealed-text.ts`), with the organization in the associated
 * data, so a ciphertext copied to another organization's row does not open.
 */
export type { MasterKey } from "../crypto/sealed-text.ts"

const associatedData = (organizationId: string): string => `company-lookup:openapi-key:${organizationId}`

export const sealKey = (master: MasterKey, organizationId: string, key: Redacted.Redacted): string =>
  sealText(master, associatedData(organizationId), key)

/** `undefined` for anything that does not open: another master key, another organization, a changed byte. */
export const openKey = (master: MasterKey, organizationId: string, stored: string): Redacted.Redacted | undefined =>
  openText(master, associatedData(organizationId), stored)
