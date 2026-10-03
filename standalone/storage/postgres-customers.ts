import { DomainConflict } from "../../cube/invoicing/index.ts"
import type { Customer, CustomersTransaction } from "../../cube/invoicing/customers/index.ts"
import { read, write } from "./postgres-errors.ts"
import {
  addressColumns, addressValues, booleanValue, buyerFrom, firstRow, optionalInteger, optionalText, text, type Row,
} from "./postgres-rows.ts"
import { assignExcluded, foldedOrder, insertStatement, nameKeyset, pairs, rowsWanted } from "./postgres-sql.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

const customerFrom = (value: Row): Customer => {
  const deletedAt = optionalText(value, "deleted_at")
  const defaultPaymentTermDays = optionalInteger(value, "default_payment_term_days")
  return {
    ...buyerFrom(value, ""),
    id: text(value, "id"),
    organizationId: text(value, "organization_id"),
    ...(defaultPaymentTermDays === undefined ? {} : { defaultPaymentTermDays }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  }
}

const customerColumns = [
  "id", "organization_id", "party_type", "legal_name", "tax_identifier",
  ...addressColumns(), "vat_registered", "default_payment_term_days",
]

const customerUpdatedColumns = customerColumns.filter((column) =>
  column !== "id" && column !== "organization_id")

// Works on the connection handed in by the store, so customer reads and writes share
// the transaction of the operation that uses them.
export const customersTransactionAdapter = (client: TransactionClient): CustomersTransaction => ({
  saveCustomer: (customer) => write("save customer", async () => {
    const statement = insertStatement("customers", pairs(customerColumns, [
      customer.id, customer.organizationId, customer.partyType, customer.name, customer.fiscalIdentifier,
      ...addressValues(customer.address), booleanValue(customer.vatRegistered),
      customer.defaultPaymentTermDays ?? null,
    ]))
    const { rowCount } = await client.query(
      `${statement.sql} ON CONFLICT (id) DO UPDATE SET ${assignExcluded(customerUpdatedColumns)}
        WHERE customers.organization_id=excluded.organization_id`,
      statement.values,
    )
    if (rowCount === 0) {
      throw new DomainConflict({ code: "customer_id_taken", message: "Customer id belongs to another organization" })
    }
  }),
  findCustomer: (organizationId, id) => read("find customer", async () => {
    const { rows } = await client.query(
      "SELECT * FROM customers WHERE organization_id = $1 AND id = $2", [organizationId, id],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : customerFrom(value)
  }),
  listCustomers: (organizationId, page) => read("list customers", async () => {
    // The fold is applied to the column AND to the cursor value, because SQLite
    // compared the bound name case-insensitively too.
    const keyset = nameKeyset(page, "legal_name", 2)
    const { rows } = await client.query(
      `SELECT * FROM customers WHERE organization_id = $1 AND deleted_at IS NULL${keyset.sql}
        ORDER BY ${foldedOrder("legal_name")} LIMIT $${String(2 + keyset.values.length)}`,
      [organizationId, ...keyset.values, rowsWanted(page)],
    )
    return rows.map(customerFrom)
  }),
  softDeleteCustomer: (organizationId, id, deletedAt) => write("soft delete customer", async () => {
    const { rowCount } = await client.query(
      `UPDATE customers SET deleted_at = $1
        WHERE organization_id = $2 AND id = $3 AND deleted_at IS NULL`, [deletedAt, organizationId, id],
    )
    if (rowCount === 0) {
      const exists = await client.query(
        "SELECT 1 FROM customers WHERE organization_id = $1 AND id = $2", [organizationId, id],
      )
      if (exists.rows.length === 0) {
        throw new DomainConflict({ code: "customer_not_found", message: "Customer not found" })
      }
    }
  }),
  hasOpenDraftsForCustomer: (organizationId, customerId) => read("check customer drafts", async () => {
    const { rows } = await client.query(
      `SELECT 1 FROM invoice_drafts
        WHERE organization_id = $1 AND customer_id = $2 AND status = 'draft' LIMIT 1`,
      [organizationId, customerId],
    )
    return rows.length > 0
  }),
})
