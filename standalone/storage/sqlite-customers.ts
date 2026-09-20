import type { DatabaseSync } from "node:sqlite"

import { DomainConflict } from "../../cube/invoicing/index.ts"
import type { Customer, CustomersTransaction } from "../../cube/invoicing/customers/index.ts"
import { addressValues, buyerFrom, nameKeyset, optionalInteger, optionalText, read, row, rowsWanted, text, write, type Row } from "./sqlite-rows.ts"

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

// Works on the connection handed in by the store, so customer reads and writes share
// the transaction of the operation that uses them.
export const customersTransactionAdapter = (database: DatabaseSync): CustomersTransaction => ({
  saveCustomer: (customer) => write("save customer", () => {
    const result = database.prepare(`INSERT INTO customers
       (id, organization_id, party_type, legal_name, tax_identifier, country_code, city, street, county, sector, postal_code, vat_registered, default_payment_term_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET party_type=excluded.party_type, legal_name=excluded.legal_name, tax_identifier=excluded.tax_identifier,
      country_code=excluded.country_code, city=excluded.city, street=excluded.street,
        county=excluded.county, sector=excluded.sector, postal_code=excluded.postal_code,
        vat_registered=excluded.vat_registered, default_payment_term_days=excluded.default_payment_term_days
      WHERE customers.organization_id=excluded.organization_id`)
      .run(customer.id, customer.organizationId, customer.partyType, customer.name, customer.fiscalIdentifier,
        ...addressValues(customer.address), Number(customer.vatRegistered), customer.defaultPaymentTermDays ?? null)
    if (result.changes === 0) throw new DomainConflict({ code: "customer_id_taken", message: "Customer id belongs to another organization" })
  }),
  findCustomer: (organizationId, id) => read("find customer", () => {
    const value = row(database.prepare("SELECT * FROM customers WHERE organization_id = ? AND id = ?").get(organizationId, id))
    return value === undefined ? undefined : customerFrom(value)
  }),
  listCustomers: (organizationId, page) => read("list customers", () => {
    const keyset = nameKeyset(page, "legal_name")
    return database.prepare(`SELECT * FROM customers
      WHERE organization_id = ? AND deleted_at IS NULL${keyset.sql}
      ORDER BY legal_name COLLATE NOCASE, id LIMIT ?`).all(organizationId, ...keyset.values, rowsWanted(page)).map((value) => customerFrom(value as Row))
  }),
  softDeleteCustomer: (organizationId, id, deletedAt) => write("soft delete customer", () => {
    const result = database.prepare(`UPDATE customers SET deleted_at = ?
      WHERE organization_id = ? AND id = ? AND deleted_at IS NULL`).run(deletedAt, organizationId, id)
    if (result.changes === 0) {
      const exists = database.prepare("SELECT 1 FROM customers WHERE organization_id = ? AND id = ?").get(organizationId, id)
      if (exists === undefined) throw new DomainConflict({ code: "customer_not_found", message: "Customer not found" })
    }
  }),
  hasOpenDraftsForCustomer: (organizationId, customerId) => read("check customer drafts", () =>
    database.prepare(`SELECT 1 FROM invoice_drafts
      WHERE organization_id = ? AND customer_id = ? AND status = 'draft' LIMIT 1`).get(organizationId, customerId) !== undefined),
})
