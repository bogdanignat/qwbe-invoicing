import { readFileSync } from "node:fs"

import { Redacted } from "effect"

import { masterKeyFromFile } from "./crypto/master-key.ts"
import type { MasterKey } from "./crypto/sealed-text.ts"
import { anafSettings, type AnafSettings } from "./efactura/anaf/config.ts"
import { parseTrustedProxies, type TrustedProxies } from "./http/trusted-proxy.ts"
import { parsePlugins, type PluginSelection } from "./plugins.ts"
import type { PostgresSettings } from "./storage/postgres-pool.ts"

export interface RuntimeConfig {
  readonly host: string
  readonly port: number
  readonly dataDirectory: string
  readonly nodeEnvironment: string
  readonly authTokenFile: string | undefined
  readonly organizationId: string | undefined
  /** Everything the pools need. The password is already read from its file. */
  readonly pgSettings: PostgresSettings
  /** `QWBE_PLUGINS`, parsed at startup: an unknown name fails here. */
  readonly plugins: PluginSelection
  /** `COMPANY_LOOKUP_KEY_FILE`, read at startup. Absent: the openapi.ro key cannot be stored, everything else runs. */
  readonly companyLookupKey?: MasterKey | undefined
  /**
   * `ANAF_ENVIRONMENT` and the ANAF OAuth client (`kernel/efactura/anaf/config.ts`),
   * read at startup. Absent from a hand-built test config: not configured, `test`.
   */
  readonly anaf?: AnafSettings | undefined
  /**
   * `PUBLIC_ORIGIN`, the one origin the browser reaches the kernel on. Host,
   * X-Forwarded-Host/Proto and Origin are pinned to it. Validated whenever it is
   * set; required only to serve in production (`kernel/http/edge-server.ts`), so
   * `migrate`, `backup`, `restore` and `doctor` run without it.
   */
  readonly publicOrigin: string | undefined
  /** `QWBE_BEARER_API=on`: the Bearer API is served on the public listener. Off by default. */
  readonly bearerApi: boolean
  /**
   * `QWBE_UI_DIR`, the Vite build (`index.html` and `assets/`). Read once when a
   * server starts (`kernel/http/ui-bundle.ts`); required to serve in production,
   * optional elsewhere. Empty means unset.
   */
  readonly uiDirectory: string | undefined
  /** `QWBE_TRUSTED_PROXY`: whose `X-Forwarded-For` keys the login throttle. Nobody by default. */
  readonly trustedProxies: TrustedProxies
}

const boundedPort = (value: string | undefined, variable: string, fallback: string): number => {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${variable} must be an integer between 1 and 65535`)
  }
  return parsed
}

/**
 * The database password, read exactly like `AUTH_TOKEN_FILE` is: from a file, at
 * startup, trimmed. It is never taken from an environment variable, so it cannot
 * reach a child process through an inherited `PGPASSWORD`, a crash dump of
 * `process.env` or a `docker inspect`. An unreadable path fails with the path
 * only, never with the contents.
 *
 * Fail-closed outside development, and it has to be: a missing secret used to
 * yield the empty string, which connects successfully against a `trust` server
 * or a role with no password and then serves as the owner of the schema. The
 * empty password survives in exactly one place — a development or test
 * environment, where the throwaway rigs are `trust` on purpose — and nowhere
 * else. `development` is not inferred: `NODE_ENV` has to say so.
 */
const secretFrom = (path: string | undefined, nodeEnvironment: string): string => {
  const permitEmpty = nodeEnvironment === "development" || nodeEnvironment === "test"
  if (path === undefined) {
    if (permitEmpty) return ""
    throw new Error("PGPASSWORD_FILE is required outside development")
  }
  let secret: string
  try {
    secret = readFileSync(path, "utf8").trim()
  } catch {
    throw new Error(`PGPASSWORD_FILE is not readable: ${path}`)
  }
  if (secret.length === 0 && !permitEmpty) {
    throw new Error(`PGPASSWORD_FILE is empty: ${path}`)
  }
  return secret
}

const postgresSettings = (environment: NodeJS.ProcessEnv, nodeEnvironment: string): PostgresSettings => ({
  host: environment.PGHOST ?? "db",
  port: boundedPort(environment.PGPORT, "PGPORT", "5432"),
  database: environment.PGDATABASE ?? "qwbe_invoicing",
  user: environment.PGUSER ?? "qwbe",
  password: secretFrom(environment.PGPASSWORD_FILE, nodeEnvironment),
})

/**
 * The master key that encrypts the openapi.ro key at rest (`kernel/crypto/master-key.ts`).
 * Unset is a supported setup; a set path that is unreadable or malformed refuses to start.
 */
const companyLookupKeyFrom = (path: string | undefined): MasterKey | undefined =>
  path === undefined ? undefined : masterKeyFromFile(path, "COMPANY_LOOKUP_KEY_FILE")

/** The ANAF tokens are sealed under their own key: one leaked or rotated key never reaches the other secret. */
const separateKeys = (companyLookupKey: MasterKey | undefined, anaf: AnafSettings): AnafSettings => {
  const tokenKey = anaf.client?.tokenKey
  if (companyLookupKey !== undefined && tokenKey !== undefined && Redacted.value(companyLookupKey).equals(Redacted.value(tokenKey))) {
    throw new Error("ANAF_TOKEN_KEY_FILE must hold its own key, not the one in COMPANY_LOOKUP_KEY_FILE")
  }
  return anaf
}

/** Canonical means exactly what `URL.origin` gives back: no path, userinfo, default port or upper case. */
const canonicalOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined
  let parsed: URL | undefined
  try {
    parsed = new URL(value)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== value) {
    throw new Error("PUBLIC_ORIGIN must be a canonical http(s) origin, e.g. https://invoice.example.com")
  }
  return value
}

/** Off unless switched on; anything that is neither `on` nor `off` refuses to start. */
const bearerSwitch = (value: string | undefined): boolean => {
  if (value === undefined || value === "" || value === "off") return false
  if (value === "on") return true
  throw new Error("QWBE_BEARER_API must be on or off")
}

export const runtimeConfig = (environment: NodeJS.ProcessEnv = process.env): RuntimeConfig => {
  const nodeEnvironment = environment.NODE_ENV ?? "development"
  const publicOrigin = canonicalOrigin(environment.PUBLIC_ORIGIN)
  const companyLookupKey = companyLookupKeyFrom(environment.COMPANY_LOOKUP_KEY_FILE)
  return {
    host: environment.HOST ?? "0.0.0.0",
    port: boundedPort(environment.PORT, "PORT", "3000"),
    dataDirectory: environment.DATA_DIR ?? "/data",
    nodeEnvironment,
    authTokenFile: environment.AUTH_TOKEN_FILE,
    organizationId: environment.ORGANIZATION_ID,
    pgSettings: postgresSettings(environment, nodeEnvironment),
    plugins: parsePlugins(environment.QWBE_PLUGINS),
    companyLookupKey,
    anaf: separateKeys(companyLookupKey, anafSettings(environment, publicOrigin)),
    publicOrigin,
    bearerApi: bearerSwitch(environment.QWBE_BEARER_API),
    trustedProxies: parseTrustedProxies(environment.QWBE_TRUSTED_PROXY),
    uiDirectory: environment.QWBE_UI_DIR === "" ? undefined : environment.QWBE_UI_DIR,
  }
}
