import { createHash } from "node:crypto"

import { Effect } from "effect"
import type { Pool } from "pg"

import { DomainConflict } from "../../cubes/invoicing/index.ts"
import {
  LOOKUP_PROVIDERS, type CompanyLookupSettingsStore, type LookupProvider, type StoredSettings,
} from "../../cubes/invoicing/company-lookup/index.ts"
import { openKey, sealKey, type MasterKey } from "../company-lookup/key-cipher.ts"
import { logInternalFailure } from "../failure-log.ts"
import { persistence, read, write } from "./postgres-errors.ts"
import { maintenanceLockKey } from "./postgres-maintenance-lock.ts"
import { firstRow, optionalText, text } from "./postgres-rows.ts"
import { transactionWith, type TransactionClient } from "./postgres-transaction.ts"

/** Its own logical key: a settings read must not wait behind an issuance. */
const companyLookupLockKey = { classId: maintenanceLockKey.classId, objectId: 5 }

const keyStorageUnavailable = new DomainConflict({ code: "company_lookup_key_storage_unavailable",
  message: "the openapi.ro key cannot be stored: COMPANY_LOOKUP_KEY_FILE is not configured" })

const providerOf = (value: string): LookupProvider => {
  const provider = LOOKUP_PROVIDERS.find((known) => known === value)
  if (provider === undefined) throw new Error("invalid provider")
  return provider
}

// Both columns that decide an answer: the key changes the ciphertext, and a fresh IV on every write changes it again.
const versionOf = (provider: string, ciphertext: string | undefined): string =>
  createHash("sha256").update(`${provider}\u0000${ciphertext ?? ""}`).digest("hex").slice(0, 16)

/**
 * One short transaction per read and per write, each a single statement under
 * the shared maintenance barrier. A lookup reads, lets the transaction go, and
 * only then asks the provider: no lock is held across a fetch.
 *
 * A key that does not open (no master key, another master key, a changed byte)
 * reads as no key, and an openapi.ro provider without one as none: the
 * integration is off until someone stores a key again, and nothing else breaks.
 */
export const createPostgresCompanyLookupStore = (pool: Pool, master: MasterKey | undefined): CompanyLookupSettingsStore => {
  const transaction = transactionWith(pool, {
    lock: companyLookupLockKey,
    adapter: (client: TransactionClient) => client,
    onBeginFailure: () => persistence("begin transaction"),
    onCommitFailure: () => persistence("commit transaction"),
  })

  // Said once per stored ciphertext, not on every lookup that reads it.
  const reported = new Set<string>()
  const settingsFrom = (organizationId: string, provider: LookupProvider, ciphertext: string | undefined): StoredSettings => {
    const version = versionOf(provider, ciphertext)
    if (ciphertext === undefined) return { provider, version }
    const openapiKey = master === undefined ? undefined : openKey(master, organizationId, ciphertext)
    if (openapiKey !== undefined) return { provider, openapiKey, version }
    if (!reported.has(version)) {
      reported.add(version)
      logInternalFailure({ kind: "server_failure", reason: "company lookup: the stored openapi.ro key does not open with this master key" })
    }
    return { provider: provider === "openapi" ? "none" : provider, version }
  }

  return {
    read: (organizationId) => transaction((client) => read("read company lookup settings", async () => {
      const { rows } = await client.query(
        "SELECT provider, openapi_key_ciphertext FROM company_lookup_settings WHERE organization_id = $1", [organizationId])
      const row = firstRow(rows)
      return row === undefined ? undefined
        : settingsFrom(organizationId, providerOf(text(row, "provider")), optionalText(row, "openapi_key_ciphertext"))
    })),

    write: (settings) => Effect.suspend(() => {
      const change = settings.openapiKey
      if (change.kind === "set" && master === undefined) return Effect.fail(keyStorageUnavailable)
      const ciphertext = change.kind === "set" && master !== undefined ? sealKey(master, settings.organizationId, change.key) : null
      return transaction((client) => write("save company lookup settings", async () => {
        await client.query(
          `INSERT INTO company_lookup_settings (organization_id, provider, openapi_key_ciphertext, updated_at, updated_by)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (organization_id) DO UPDATE SET provider = EXCLUDED.provider,
              openapi_key_ciphertext = CASE WHEN $6 = 'keep' THEN company_lookup_settings.openapi_key_ciphertext ELSE EXCLUDED.openapi_key_ciphertext END,
              updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
          [settings.organizationId, settings.provider, ciphertext, settings.updatedAt, settings.updatedBy, change.kind])
      }))
    }),
  }
}
