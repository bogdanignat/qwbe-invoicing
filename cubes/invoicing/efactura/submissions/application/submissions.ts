import { Effect } from "effect"

import {
  DomainConflict, PermissionDenied, ResourceNotFound, type AuthenticationRequired, type OrganizationContextMissing,
  type PersistenceFailure, type ValidationFailure,
} from "../../../contracts/failures.ts"
import type { RequestContext } from "../../../contracts/host.ts"
import { connectionStatus, spvCif } from "../../connection/index.ts"
import { documentStatus } from "../domain/states.ts"
import { submissionAudit } from "./audit.ts"
import type {
  ConnectionState, SubmissionDocument, SubmissionRecord, SubmissionsDependencies, SubmissionsTransaction, SubmittedKind,
} from "./ports.ts"

/** ANAF's upload limit, and the stored column's. */
export const MAX_XML_BYTES = 10 * 1024 * 1024

export type SubmissionsFailure =
  | AuthenticationRequired | OrganizationContextMissing | PermissionDenied | DomainConflict | ResourceNotFound
  | ValidationFailure | PersistenceFailure

export interface SubmissionHistory {
  /** The newest submission that was not superseded: the one the document's status shows. */
  readonly current: SubmissionRecord | null
  /** Newest first. */
  readonly submissions: ReadonlyArray<SubmissionRecord>
}

export interface Submitted {
  readonly submission: SubmissionRecord
  /** `false`: the document already had a live, `unknown` or accepted submission, which is answered instead. */
  readonly created: boolean
}

const conflict = (code: string, message: string) => Effect.fail(new DomainConflict({ code, message }))

export const createSubmissionsService = (dependencies: SubmissionsDependencies) => {
  const { clock, configured, environment, ids, permissions, store } = dependencies

  const authorize = (permission: string): Effect.Effect<RequestContext, SubmissionsFailure> =>
    Effect.flatMap(dependencies.context.current, (context) =>
      context.identity.permissions.includes(permission) ? Effect.succeed(context) : Effect.fail(new PermissionDenied({ permission })))

  /** The CIF the upload names: the snapshot's, and only when it is the one ANAF proved the connection has a right on. */
  const uploadCif = (connection: ConnectionState | undefined, document: SubmissionDocument, at: Date) => {
    if (!configured) return conflict("efactura_not_configured", "ANAF e-Factura is not configured")
    if (connectionStatus(true, connection, at) !== "connected" || connection?.verifiedCif === undefined) {
      return conflict("efactura_not_connected", "connect to ANAF e-Factura before submitting")
    }
    const cif = spvCif(document.issuerFiscalIdentifier)
    if (cif !== connection.verifiedCif) {
      return conflict("efactura_cif_mismatch", "the document's issuer CIF is not the CIF the ANAF connection was verified for")
    }
    return Effect.succeed(cif)
  }

  const submit = (document: SubmissionDocument): Effect.Effect<Submitted, SubmissionsFailure> => Effect.gen(function*() {
    const context = yield* authorize(permissions.submit)
    if (document.buyerIsIndividual) return yield* conflict("efactura_b2c_refused", "documents for a private person are not sent to e-Factura")
    const organizationId = context.organization.id
    const current = (transaction: SubmissionsTransaction) =>
      transaction.findCurrent(organizationId, environment, document.kind, document.id)
    const now = yield* clock.now
    const [existing, connection] = yield* store.transaction((transaction) =>
      Effect.all([current(transaction), transaction.findConnection(organizationId)]))
    if (existing !== undefined) return { submission: existing, created: false }
    const cif = yield* uploadCif(connection, document, now)
    const xml = yield* document.xml
    if (xml.byteLength > MAX_XML_BYTES) return yield* conflict("efactura_xml_too_large", "the e-Factura XML is larger than 10 MB")
    const [id, auditId] = yield* Effect.all([ids.next, ids.next])
    const at = now.toISOString()
    // Serialised with every other submission write: a concurrent submit of the same document finds this one.
    return yield* store.transaction((transaction) => Effect.gen(function*() {
      const raced = yield* current(transaction)
      if (raced !== undefined) return { submission: raced, created: false }
      const stored = yield* transaction.insert({ id, organizationId, environment, documentKind: document.kind, documentId: document.id,
        cif, xml, createdBy: context.identity.id, createdAt: at })
      yield* transaction.project(organizationId, document.kind, document.id, documentStatus(stored.state))
      yield* transaction.appendAuditEvent(submissionAudit(auditId, stored, context.identity.id, at, "queued", `${document.kind}:${document.id}`))
      return { submission: stored, created: true }
    }))
  })

  const history = (kind: SubmittedKind, documentId: string): Effect.Effect<SubmissionHistory, SubmissionsFailure> =>
    Effect.gen(function*() {
      const context = yield* authorize(permissions.read)
      const submissions = yield* store.transaction((transaction) => transaction.history(context.organization.id, kind, documentId))
      return { current: submissions.find((submission) => !submission.superseded) ?? null, submissions }
    })

  /** The exact XML that was submitted, or ANAF's stored ZIP. */
  const bytes = (id: string, which: "readXml" | "readResponse"): Effect.Effect<Uint8Array, SubmissionsFailure> => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const found = yield* store.transaction((transaction) => transaction[which](context.organization.id, id))
    if (found === undefined) return yield* Effect.fail(new ResourceNotFound({ resource: "efactura_submission", id }))
    return found
  })

  return {
    submit,
    history,
    xml: (id: string) => bytes(id, "readXml"),
    response: (id: string) => bytes(id, "readResponse"),
  }
}

export type SubmissionsService = ReturnType<typeof createSubmissionsService>
