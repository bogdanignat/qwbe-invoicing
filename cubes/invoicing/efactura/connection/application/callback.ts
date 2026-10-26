import { Effect, Redacted } from "effect"

import type { DomainConflict, PersistenceFailure } from "../../../contracts/failures.ts"
import {
  REFRESH_TOKEN_DAYS, attemptOutcome, cifOutcome, spvCif, usableCode, type CallbackOutcome,
} from "../domain/callback.ts"
import { DAY_MS, attemptVerdict } from "../domain/connection.ts"
import type { TokenGrant } from "../domain/token-reply.ts"
import { connectionAudit } from "./audit.ts"
import type { AnafGateway, AttemptRecord, ConnectionHost } from "./ports.ts"

/** How a granted pair ended, and the refresh token that is no longer kept (to revoke after the commit). */
interface Saved {
  readonly outcome: CallbackOutcome
  readonly unused: Redacted.Redacted | undefined
}

/** What the browser brought back: the attempt cookie and ANAF's query, unread by anything else. */
export interface CallbackInput {
  readonly nonce: Redacted.Redacted | undefined
  readonly code: string | undefined
  /** ANAF answered `error=`, whatever it said. */
  readonly refused: boolean
}

/**
 * ANAF's callback, fail-closed at every step. An `error` answer or a missing
 * code ends before the attempt is read: any page can send the browser here, so
 * only a callback carrying a code may consume it (an untouched attempt lapses on
 * its own). The attempt is consumed in its own short transaction; the code
 * exchange and the right check on the issuer's
 * CIF run outside any transaction; the connection is saved only after a
 * recognised positive answer, and only if the consumed attempt is still the
 * organization's current one and the generation it started from still holds.
 * A late callback of a replaced attempt, or one that a disconnect overtook,
 * writes nothing. Once ANAF has granted a pair, the pair that is not kept (the
 * new one when nothing is saved, the old one when a connection replaces it)
 * is revoked after the commit, best effort, without changing the outcome.
 */
export const completeCallback = (host: ConnectionHost) =>
  (input: CallbackInput): Effect.Effect<CallbackOutcome, DomainConflict | PersistenceFailure> => Effect.gen(function*() {
    const { anaf, clock, store } = host
    if (anaf === undefined) return "neconfigurat"
    if (input.nonce === undefined) return "tentativa_lipsa"
    if (input.refused) return "refuzat_anaf"
    if (!usableCode(input.code)) return "cod_lipsa"
    const code = input.code
    const nonceHash = anaf.nonceHash(input.nonce)
    const now = yield* clock.now
    const claim = yield* store.transaction((transaction) => Effect.gen(function*() {
      const attempt = yield* transaction.findAttemptByHash(nonceHash)
      const verdict = attemptVerdict(attempt, now)
      if (verdict !== "usable") return { outcome: attemptOutcome[verdict] }
      if (attempt === undefined) return { outcome: attemptOutcome.missing }
      yield* transaction.consumeAttempt(attempt.organizationId, nonceHash)
      return { attempt, fiscalIdentifier: yield* transaction.findIssuerFiscalIdentifier(attempt.organizationId) }
    }))
    if ("outcome" in claim) return claim.outcome
    const reply = yield* anaf.exchangeCode(Redacted.make(code))
    if (reply.kind !== "granted") return "schimb_esuat"
    const { grant } = reply
    const verdict = yield* verified(anaf, grant, claim.fiscalIdentifier, now)
    const saved = typeof verdict === "string"
      ? { outcome: cifOutcome[verdict], unused: grant.refreshToken }
      : yield* saveConnection(host, claim.attempt, grant, verdict.cif)
    if (saved.unused !== undefined) yield* anaf.revoke(saved.unused)
    return saved.outcome
  })

const verified = (anaf: AnafGateway, grant: TokenGrant, fiscalIdentifier: string | undefined, at: Date) => {
  const cif = spvCif(fiscalIdentifier ?? "")
  if (cif === undefined) return Effect.succeed("failed" as const)
  return Effect.map(anaf.verifyCif(grant.accessToken, cif, at), (verdict) => verdict === "granted" ? { cif } : verdict)
}

const saveConnection = (host: ConnectionHost, attempt: AttemptRecord, grant: TokenGrant, cif: string) => Effect.gen(function*() {
  const { organizationId, createdBy } = attempt
  const now = yield* host.clock.now
  const audit = yield* connectionAudit(host, organizationId, createdBy, now, "connected")
  return yield* host.store.transaction((transaction) => Effect.gen(function*() {
    const current = yield* transaction.findAttempt(organizationId)
    const record = yield* transaction.findConnection(organizationId)
    if (current?.nonceHash !== attempt.nonceHash || !current.consumed || record?.generation !== attempt.generation) {
      return { outcome: "conexiune_schimbata", unused: grant.refreshToken } satisfies Saved
    }
    const at = now.toISOString()
    yield* transaction.saveConnection(organizationId, {
      status: "connected", generation: record.generation + 1, revision: 0,
      identity: { verifiedCif: cif, connectedBy: createdBy, connectedAt: at,
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_DAYS * DAY_MS).toISOString() },
      tokens: { access: grant.accessToken, refresh: grant.refreshToken,
        accessExpiresAt: new Date(now.getTime() + grant.accessExpiresInSeconds * 1000).toISOString() },
      updatedBy: createdBy, updatedAt: at,
    })
    yield* transaction.appendAuditEvent(audit)
    return { outcome: "conectat", unused: typeof record.tokens === "object" ? record.tokens.refresh : undefined } satisfies Saved
  }))
})
