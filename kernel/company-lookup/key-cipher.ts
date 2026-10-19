import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import { Redacted } from "effect"

/**
 * The openapi.ro key at rest: AES-256-GCM under the master key from
 * `COMPANY_LOOKUP_KEY_FILE`, a fresh 12-byte IV on every write, and the
 * organization as associated data, so a ciphertext copied to another
 * organization's row does not open. Stored as `v1.<iv>.<tag>.<ciphertext>`, base64url.
 */
const VERSION = "v1"
const IV_BYTES = 12
const TAG_BYTES = 16

export type MasterKey = Redacted.Redacted<Buffer>

const associatedData = (organizationId: string): Buffer => Buffer.from(`company-lookup:openapi-key:${organizationId}`)

export const sealKey = (master: MasterKey, organizationId: string, key: Redacted.Redacted): string => {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", Redacted.value(master), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(associatedData(organizationId))
  const sealed = Buffer.concat([cipher.update(Redacted.value(key), "utf8"), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), sealed].map((part) => typeof part === "string" ? part : part.toString("base64url")).join(".")
}

/** `undefined` for anything that does not open: another master key, another organization, a changed byte. */
export const openKey = (master: MasterKey, organizationId: string, stored: string): Redacted.Redacted | undefined => {
  const [version, iv, tag, sealed, ...rest] = stored.split(".")
  if (version !== VERSION || iv === undefined || tag === undefined || sealed === undefined || rest.length > 0) return undefined
  try {
    const decipher = createDecipheriv("aes-256-gcm", Redacted.value(master), Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES })
    decipher.setAAD(associatedData(organizationId))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    const plain = Buffer.concat([decipher.update(Buffer.from(sealed, "base64url")), decipher.final()])
    return Redacted.make(plain.toString("utf8"))
  } catch {
    return undefined
  }
}
