import { efacturaPermissions } from "../connection/index.ts"

/**
 * Submissions of issued documents to ANAF e-Factura: the fiscal and archive
 * states with every transition they allow, the reading of ANAF's answers, the
 * polling backoff, the call budgets, and the service that queues a document and
 * reads its history. The cube is pure: HTTP, storage, the dispatcher and the
 * XML bytes are the host's. It is required inside the e-Factura plugin, so it
 * is on exactly when e-Factura is. Its grant carries the plugin's name.
 */
export const cube = {
  manifest: {
    name: "submissions",
    parent: "efactura",
    summary: "ANAF e-Factura submissions: states, transitions, answers, polling and call budgets",
    required: true,
    tables: [
      "efactura_submissions", "efactura_resubmissions", "efactura_submission_attempts", "efactura_responses",
      "efactura_dispatcher_epoch", "efactura_message_budgets", "efactura_rate_limits",
    ],
    requiresAuth: true,
    permissions: [{ name: efacturaPermissions("efactura").submit, roles: ["admin"] }],
  },
  create: () => ({ handlers: {} }),
}

export { submissionsMigrations, type SubmissionsMigration } from "./contracts/migrations.ts"
export {
  ARCHIVE_STATES, FISCAL_STATES, FISCAL_TRANSITIONS, LIVE_STATES, archiveFor, canStoreArchive, canSupersede, documentStatus, fiscalTransition,
} from "./domain/states.ts"
export type { ArchiveState, FiscalEvent, FiscalState } from "./domain/states.ts"
export { ANAF_XML_LIMITS, childrenNamed, localName, parseStrictXml } from "./domain/xml.ts"
export type { XmlElement, XmlLimits, XmlParse, XmlRefusal } from "./domain/xml.ts"
export { CALL_OUTCOMES, anafId, sanitizedMessages, type AnafReply, type CallOutcome, type Interrupted } from "./domain/replies.ts"
export { UPLOAD_EVENTS, classifyStatus, classifyUpload, statusEvent, type StatusResult, type UploadResult } from "./domain/xml-replies.ts"
export { classifyDownload, classifyList, classifyValidation, validationEvent } from "./domain/json-replies.ts"
export type { DownloadResult, ListResult, ListedMessage, ValidationResult } from "./domain/json-replies.ts"
export { LATER_POLL_MINUTES, POLL_DELAYS_MINUTES, nextPollAt, pollDelayMinutes } from "./domain/polling.ts"
export {
  MAX_RETRY_AFTER_SECONDS, MESSAGE_CALLS_PER_DAY, NEVER_PAUSED, ORGANIZATION_CALLS_PER_MINUTE,
  bucharestDay, nextBucharestMidnight, pauseAfterRateLimit, reserveMessageCall, reserveOrganizationCall, retryAfterSeconds,
} from "./domain/budgets.ts"
export type { BudgetedOperation, MessageBudget, OrganizationBudget, OrganizationReservation } from "./domain/budgets.ts"
export { auditedArrival, submissionAudit, type AuditedSubmission, type SubmissionAuditAction } from "./application/audit.ts"
export {
  MAX_XML_BYTES, checkedUpload, createSubmissionsService, type SubmissionHistory, type SubmissionsFailure, type SubmissionsService,
  type Submitted,
} from "./application/submissions.ts"
export type {
  ConnectionState, NewSubmission, Resubmission, SubmissionDocument, SubmissionRecord, SubmissionsDependencies, SubmissionsTransaction, SubmittedKind,
} from "./application/ports.ts"
