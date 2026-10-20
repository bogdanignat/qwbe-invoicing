import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import { Redacted } from "effect"

/**
 * A secret at rest: AES-256-GCM under a 32-byte master key, a fresh 12-byte IV
 * on every write, and associated data that names where the ciphertext belongs,
 * so a value copied to another row or column does not open. Stored as
 * `v1.<iv>.<tag>.<ciphertext>`, base64url. The callers own their associated
 * data (`kernel/company-lookup/key-cipher.ts`, the e-Factura tokens).
 */
const VERSION = "v1"
const IV_BYTES = 12
const TAG_BYTES = 16

export type MasterKey = Redacted.Redacted<Buffer>

export const sealText = (master: MasterKey, associatedData: string, plain: Redacted.Redacted): string => {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", Redacted.value(master), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(Buffer.from(associatedData))
  const sealed = Buffer.concat([cipher.update(Redacted.value(plain), "utf8"), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), sealed].map((part) => typeof part === "string" ? part : part.toString("base64url")).join(".")
}

/** `undefined` for anything that does not open: another master key, other associated data, a changed byte. */
export const openText = (master: MasterKey, associatedData: string, stored: string): Redacted.Redacted | undefined => {
  const [version, iv, tag, sealed, ...rest] = stored.split(".")
  if (version !== VERSION || iv === undefined || tag === undefined || sealed === undefined || rest.length > 0) return undefined
  try {
    const decipher = createDecipheriv("aes-256-gcm", Redacted.value(master), Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(associatedData))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    const plain = Buffer.concat([decipher.update(Buffer.from(sealed, "base64url")), decipher.final()])
    return Redacted.make(plain.toString("utf8"))
  } catch {
    return undefined
  }
}
