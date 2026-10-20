import { readFileSync } from "node:fs"

import { Redacted } from "effect"

import type { MasterKey } from "./sealed-text.ts"

/**
 * A master key from its file: 32 bytes written as 64 hex characters
 * (`openssl rand -hex 32`, or `scripts/init-secrets.sh`), read once at
 * startup and never from an environment value. An unreadable or malformed file
 * refuses to start, naming the variable and the path, never the contents.
 */
export const masterKeyFromFile = (path: string, variable: string): MasterKey => {
  let hex: string
  try {
    hex = readFileSync(path, "utf8").trim()
  } catch {
    throw new Error(`${variable} is not readable: ${path}`)
  }
  if (!/^[0-9a-f]{64}$/iu.test(hex)) throw new Error(`${variable} must hold 64 hex characters: ${path}`)
  return Redacted.make(Buffer.from(hex, "hex"))
}
