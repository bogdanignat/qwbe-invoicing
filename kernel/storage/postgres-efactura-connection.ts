import type { Pool } from "pg"

import type { TransactionalStore } from "../../cubes/invoicing/index.ts"
import type {
  AnafEnvironment, ConnectionRecord, ConnectionTransaction, ConnectionWrite, StoredConnectionStatus, TokenKind,
} from "../../cubes/invoicing/efactura/connection/index.ts"
import type { AnafClient } from "../efactura/anaf/config.ts"
import { tokenCipher, type TokenCipher } from "../efactura/anaf/token-cipher.ts"
import { attemptsAdapter } from "./postgres-efactura-attempts.ts"
import { persistence, read, write } from "./postgres-errors.ts"
import { appendAuditEvent } from "./postgres-kernel.ts"
import { maintenanceLockKey } from "./postgres-maintenance-lock.ts"
import { firstRow, integer, optionalText, text, type Row } from "./postgres-rows.ts"
import { transactionWith, type TransactionClient } from "./postgres-transaction.ts"

/** Its own logical key: a connection write never waits behind an issuance, and every connection transaction is serialised. */
const efacturaConnectionLockKey = { classId: maintenanceLockKey.classId, objectId: 6 }

const STATUSES: ReadonlyArray<StoredConnectionStatus> = ["disconnected", "connected", "needs_reconnect"]

/** Both tokens open, or the pair is `unreadable`: half a pair is never used. */
const tokensFrom = (row: Row, cipher: TokenCipher): ConnectionRecord["tokens"] => {
  const [access, refresh] = [optionalText(row, "access_token_ciphertext"), optionalText(row, "refresh_token_ciphertext")]
  if (access === undefined || refresh === undefined) return undefined
  const [organizationId, generation] = [text(row, "organization_id"), integer(row, "generation")]
  const opened = { access: cipher.open(organizationId, generation, "access", access), refresh: cipher.open(organizationId, generation, "refresh", refresh) }
  return opened.access === undefined || opened.refresh === undefined ? "unreadable" : { access: opened.access, refresh: opened.refresh }
}

const connectionFrom = (row: Row, cipher: TokenCipher): ConnectionRecord => {
  const status = STATUSES.find((known) => known === text(row, "status"))
  if (status === undefined) throw new Error("invalid status")
  const verifiedCif = optionalText(row, "verified_cif")
  return {
    status, generation: integer(row, "generation"), revision: integer(row, "revision"), tokens: tokensFrom(row, cipher),
    accessExpiresAt: optionalText(row, "access_expires_at"),
    identity: verifiedCif === undefined ? undefined : {
      verifiedCif, connectedBy: text(row, "connected_by"), connectedAt: text(row, "connected_at"), refreshExpiresAt: text(row, "refresh_expires_at"),
    },
  }
}

const adapter = (client: TransactionClient, cipher: TokenCipher, environment: AnafEnvironment): ConnectionTransaction => {
  return {
    findConnection: (organizationId) => read("find e-Factura connection", async () => {
      const { rows } = await client.query("SELECT * FROM efactura_connections WHERE organization_id = $1", [organizationId])
      const row = firstRow(rows)
      return row === undefined ? undefined : connectionFrom(row, cipher)
    }),
    saveConnection: (organizationId, connection: ConnectionWrite) => write("save e-Factura connection", async () => {
      const { identity, tokens, generation } = connection
      const sealed = (kind: TokenKind) => tokens === undefined ? null : cipher.seal(organizationId, generation, kind, tokens[kind])
      await client.query(
        `INSERT INTO efactura_connections (organization_id, environment, status, generation, revision, access_token_ciphertext,
          refresh_token_ciphertext, access_expires_at, refresh_expires_at, verified_cif, connected_by, connected_at, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (organization_id) DO UPDATE SET environment = EXCLUDED.environment, status = EXCLUDED.status,
            generation = EXCLUDED.generation, revision = EXCLUDED.revision, access_token_ciphertext = EXCLUDED.access_token_ciphertext,
            refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext, access_expires_at = EXCLUDED.access_expires_at,
            refresh_expires_at = EXCLUDED.refresh_expires_at, verified_cif = EXCLUDED.verified_cif, connected_by = EXCLUDED.connected_by,
            connected_at = EXCLUDED.connected_at, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [organizationId, environment, connection.status, generation, connection.revision, sealed("access"), sealed("refresh"),
          tokens?.accessExpiresAt ?? null, identity?.refreshExpiresAt ?? null, identity?.verifiedCif ?? null, identity?.connectedBy ?? null,
          identity?.connectedAt ?? null, connection.updatedBy, connection.updatedAt])
    }),
    ...attemptsAdapter(client),
    findIssuerFiscalIdentifier: (organizationId) => read("find issuer fiscal identifier", async () => {
      const { rows } = await client.query("SELECT tax_identifier FROM issuers WHERE organization_id = $1", [organizationId])
      const row = firstRow(rows)
      return row === undefined ? undefined : text(row, "tax_identifier")
    }),
    appendAuditEvent: (event) => write("append audit event", () => appendAuditEvent(client, event)),
  }
}

/**
 * One short transaction per step, under its own lock, so the read that checks a
 * condition and the write it guards cannot be split by another connection
 * write. No HTTP call ever runs inside one.
 */
export const createPostgresConnectionStore = (
  pool: Pool, client: AnafClient | undefined, environment: AnafEnvironment,
): TransactionalStore<ConnectionTransaction> => {
  const cipher = tokenCipher(client, environment)
  return {
    transaction: transactionWith(pool, {
      lock: efacturaConnectionLockKey,
      adapter: (transaction: TransactionClient) => adapter(transaction, cipher, environment),
      onBeginFailure: () => persistence("begin transaction"),
      onCommitFailure: () => persistence("commit transaction"),
    }),
  }
}
