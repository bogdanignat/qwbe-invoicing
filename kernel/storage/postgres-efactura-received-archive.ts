import type { AnafEnvironment } from "../../cubes/invoicing/efactura/connection/index.ts"
import type { Interpretation } from "../../cubes/invoicing/efactura/received/index.ts"
import { moneyValue } from "./postgres-money.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/** One received message of an organization in one environment. */
export interface MessageKey {
  readonly organizationId: string
  readonly environment: AnafEnvironment
  readonly messageId: string
}

const KEY = "organization_id=$1 AND environment=$2 AND anaf_message_id=$3"
const keyValues = (key: MessageKey) => [key.organizationId, key.environment, key.messageId] as const

/** ANAF's ZIP exactly as it came, with its digest and size; the table refuses any later change. */
export const storeArchive = async (client: TransactionClient, key: MessageKey, archive: Uint8Array, at: string): Promise<void> => {
  await client.query(`INSERT INTO efactura_received_archives(organization_id,environment,anaf_message_id,archive,sha256,size,stored_at)
    VALUES($1,$2,$3,$4::bytea,encode(sha256($4::bytea),'hex'),octet_length($4::bytea),$5)`, [...keyValues(key), archive, at])
}

/**
 * What was read out of an archive, in place of whatever was read before: a
 * reread after a parser fix goes through here too. A read invoice and an
 * unreadable one are two tables, so every column of each is NOT NULL; this is
 * the one writer, and it leaves exactly one of the two rows.
 */
export const saveInterpretation = async (client: TransactionClient, key: MessageKey, interpretation: Interpretation, at: string): Promise<void> => {
  await client.query(`DELETE FROM efactura_received_invoices WHERE ${KEY}`, keyValues(key))
  await client.query(`DELETE FROM efactura_received_unreadable WHERE ${KEY}`, keyValues(key))
  if (!interpretation.readable) {
    await client.query(`INSERT INTO efactura_received_unreadable(organization_id,environment,anaf_message_id,reason,read_at)
      VALUES($1,$2,$3,$4::jsonb,$5)`, [...keyValues(key), JSON.stringify(interpretation.reason), at])
    return
  }
  const { listing } = interpretation
  await client.query(`INSERT INTO efactura_received_invoices(organization_id,environment,anaf_message_id,document_kind,number,issue_date,
    currency,supplier_name,supplier_cif,total_excluding_tax,tax_total,payable,content,warnings,read_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15)`, [...keyValues(key), listing.kind, listing.number,
    listing.issueDate, listing.currency, listing.supplierName, listing.supplierCif, moneyValue(listing.totalExcludingTax),
    moneyValue(listing.taxTotal), moneyValue(listing.payable), JSON.stringify(interpretation.document),
    JSON.stringify(interpretation.warnings), at])
}
