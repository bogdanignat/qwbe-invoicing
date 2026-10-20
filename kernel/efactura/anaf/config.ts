import { readFileSync } from "node:fs"

import { Redacted } from "effect"

import { isAnafEnvironment, type AnafEnvironment } from "../../../cubes/invoicing/efactura/connection/index.ts"
import { masterKeyFromFile } from "../../crypto/master-key.ts"
import type { MasterKey } from "../../crypto/sealed-text.ts"

/** The one route ANAF sends the browser back to; `ANAF_REDIRECT_URI` must name exactly it. */
export const ANAF_CALLBACK_PATH = "/api/anaf/callback"

/** The OAuth client registered in ANAF's portal, with the key that seals its tokens at rest. */
export interface AnafClient {
  readonly clientId: string
  readonly redirectUri: string
  readonly clientSecret: Redacted.Redacted
  readonly tokenKey: MasterKey
}

/**
 * `ANAF_ENVIRONMENT` is always known (`test` unless `prod` is written out);
 * `client` is `undefined` while none of the four client variables is set,
 * which is a supported setup: e-Factura answers "not configured".
 */
export interface AnafSettings {
  readonly environment: AnafEnvironment
  readonly client: AnafClient | undefined
}

const CLIENT_VARIABLES = ["ANAF_CLIENT_ID", "ANAF_REDIRECT_URI", "ANAF_CLIENT_SECRET_FILE", "ANAF_TOKEN_KEY_FILE"] as const

const anafEnvironment = (value: string | undefined): AnafEnvironment => {
  if (value === undefined || value === "") return "test"
  if (isAnafEnvironment(value)) return value
  throw new Error("ANAF_ENVIRONMENT must be test or prod")
}

const clientId = (value: string): string => {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(value)) throw new Error("ANAF_CLIENT_ID must be 8 to 128 letters, digits, - or _")
  return value
}

/** Compared exactly at ANAF, so it is held to one canonical spelling: https, the callback path, nothing else. */
const redirectUri = (value: string, publicOrigin: string | undefined): string => {
  let url: URL | undefined
  try {
    url = new URL(value)
  } catch {
    url = undefined
  }
  if (url === undefined || url.protocol !== "https:" || url.pathname !== ANAF_CALLBACK_PATH || url.href !== value
    || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw new Error(`ANAF_REDIRECT_URI must be exactly https://<host>${ANAF_CALLBACK_PATH}`)
  }
  if (publicOrigin !== undefined && url.origin !== publicOrigin) throw new Error("ANAF_REDIRECT_URI must be on PUBLIC_ORIGIN")
  return value
}

/** The client secret: one line of printable characters, never printed back. */
const clientSecret = (path: string): Redacted.Redacted => {
  let secret: string
  try {
    secret = readFileSync(path, "utf8").trim()
  } catch {
    throw new Error(`ANAF_CLIENT_SECRET_FILE is not readable: ${path}`)
  }
  if (!/^[\x21-\x7e]{1,4096}$/u.test(secret)) throw new Error(`ANAF_CLIENT_SECRET_FILE must hold one line of printable characters: ${path}`)
  return Redacted.make(secret)
}

/**
 * Read once at startup. All four client variables or none: a partial setup
 * refuses to start and names what is missing, so a typo cannot leave
 * e-Factura half-configured. An empty value counts as unset.
 */
export const anafSettings = (environment: NodeJS.ProcessEnv, publicOrigin: string | undefined): AnafSettings => {
  const anaf = anafEnvironment(environment.ANAF_ENVIRONMENT)
  const value = (name: (typeof CLIENT_VARIABLES)[number]) => environment[name] === "" ? undefined : environment[name]
  const missing = CLIENT_VARIABLES.filter((name) => value(name) === undefined)
  if (missing.length === CLIENT_VARIABLES.length) return { environment: anaf, client: undefined }
  if (missing.length > 0) throw new Error(`ANAF e-Factura is partly configured; also set ${missing.join(", ")} (all four or none)`)
  const required = (name: (typeof CLIENT_VARIABLES)[number]): string => value(name) ?? ""
  return {
    environment: anaf,
    client: {
      clientId: clientId(required("ANAF_CLIENT_ID")),
      redirectUri: redirectUri(required("ANAF_REDIRECT_URI"), publicOrigin),
      clientSecret: clientSecret(required("ANAF_CLIENT_SECRET_FILE")),
      tokenKey: masterKeyFromFile(required("ANAF_TOKEN_KEY_FILE"), "ANAF_TOKEN_KEY_FILE"),
    },
  }
}
