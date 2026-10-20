import { DomainConflict, type EFacturaStatus } from "../../cubes/invoicing/index.ts"
import {
  ARCHIVE_STATES, FISCAL_STATES, type SubmissionRecord, type SubmittedKind,
} from "../../cubes/invoicing/efactura/submissions/index.ts"
import { maintenanceLockKey } from "./postgres-maintenance-lock.ts"
import { flag, integer, nullableText, text, type Row } from "./postgres-rows.ts"
import type { AdvisoryLockKey, TransactionClient } from "./postgres-transaction.ts"

/** Every write to a submission, from a request or from the dispatcher, under one key. */
export const efacturaSubmissionsLockKey: AdvisoryLockKey = { classId: maintenanceLockKey.classId, objectId: 7 }

/** The row without its bytes: the XML and the ZIP are read only when asked for. */
export const SUBMISSION_COLUMNS = "id,organization_id,environment,document_kind,document_id,standard,cif,buyer_is_individual,state,archive_state,"
  + "upload_index,download_id,errors,superseded,xml_sha256,xml_size,created_by,created_at,updated_at"

export const STANDARDS: Readonly<Record<SubmittedKind, "UBL" | "CN">> = { invoice: "UBL", correction: "CN" }
const DOCUMENT_TABLES: Readonly<Record<SubmittedKind, string>> = { invoice: "issued_invoices", correction: "correction_documents" }

export const oneOf = <T extends string>(known: ReadonlyArray<T>, row: Row, field: string): T => {
  const found = known.find((value) => value === text(row, field))
  if (found === undefined) throw new Error(`invalid ${field}`)
  return found
}

const errorsFrom = (row: Row): ReadonlyArray<string> => {
  const parsed: unknown = JSON.parse(text(row, "errors"))
  if (!Array.isArray(parsed) || !parsed.every((error) => typeof error === "string")) throw new Error("invalid errors")
  return parsed
}

export const submissionFrom = (row: Row): SubmissionRecord => ({
  id: text(row, "id"), organizationId: text(row, "organization_id"), environment: oneOf(["test", "prod"], row, "environment"),
  documentKind: oneOf(["invoice", "correction"], row, "document_kind"), documentId: text(row, "document_id"),
  standard: oneOf(["UBL", "CN"], row, "standard"), cif: text(row, "cif"), buyerIsIndividual: flag(row, "buyer_is_individual"),
  state: oneOf(FISCAL_STATES, row, "state"), archiveState: oneOf(ARCHIVE_STATES, row, "archive_state"), uploadIndex: nullableText(row, "upload_index"),
  downloadId: nullableText(row, "download_id"), errors: errorsFrom(row), superseded: row.superseded === true,
  xmlSha256: text(row, "xml_sha256"), xmlSize: integer(row, "xml_size"), createdBy: text(row, "created_by"),
  createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
})

/** The document's `e_factura_status`, written only in the transaction that moves its submission. */
export const projectDocument = async (
  client: TransactionClient, organizationId: string, kind: SubmittedKind, documentId: string, status: EFacturaStatus,
): Promise<void> => {
  const { rowCount } = await client.query(`UPDATE ${DOCUMENT_TABLES[kind]} SET e_factura_status=$3 WHERE organization_id=$1 AND id=$2`,
    [organizationId, documentId, status])
  if (rowCount !== 1) throw new DomainConflict({ code: "efactura_document_missing", message: "the submitted document is not there" })
}
