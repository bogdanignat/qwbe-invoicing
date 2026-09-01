import { DatabaseSync } from "node:sqlite"

import { Effect } from "effect"

import {
  DomainConflict,
  PersistenceFailure,
  type Address,
  type Customer,
  type DraftLine,
  type DocumentSeries,
  type InvoicingTransaction,
  type IssuedInvoice,
  type PartySnapshot,
  type TaxBreakdown,
  type TaxConfiguration,
  type TransactionalStore,
} from "../cube/invoicing/index.ts"
import { databasePath } from "./migrations.ts"

type WriteFailure = DomainConflict | PersistenceFailure
type Row = Readonly<Record<string, unknown>>

interface TransactionHandle {
  readonly database: DatabaseSync
  open: boolean
}

const persistence = (operation: string) => new PersistenceFailure({ operation })

const writeFailure = (error: unknown, operation: string): WriteFailure => {
  if (error instanceof DomainConflict) return error
  if (typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT")) {
    return new DomainConflict({ code: "persistence_conflict", message: `Conflict while performing ${operation}` })
  }
  return persistence(operation)
}

const write = <Value>(operation: string, run: () => Value): Effect.Effect<Value, WriteFailure> =>
  Effect.try({ try: run, catch: (error) => writeFailure(error, operation) })

const read = <Value>(operation: string, run: () => Value): Effect.Effect<Value, PersistenceFailure> =>
  Effect.try({ try: run, catch: () => persistence(operation) })

const row = (value: unknown): Row | undefined =>
  typeof value === "object" && value !== null ? value as Row : undefined

const text = (value: Row, field: string): string => {
  const result = value[field]
  if (typeof result !== "string") throw new Error(`invalid ${field}`)
  return result
}

const optionalText = (value: Row, field: string): string | undefined => {
  const result = value[field]
  if (result === null || result === undefined) return undefined
  if (typeof result !== "string") throw new Error(`invalid ${field}`)
  return result
}

const integer = (value: Row, field: string): number => {
  const result = value[field]
  if (typeof result !== "number" || !Number.isInteger(result)) throw new Error(`invalid ${field}`)
  return result
}

const addressFrom = (value: Row, prefix = ""): Address => {
  const county = optionalText(value, `${prefix}county`)
  const postalCode = optionalText(value, `${prefix}postal_code`)
  return {
    countryCode: text(value, `${prefix}country_code`),
    city: text(value, `${prefix}city`),
    street: text(value, `${prefix}street`),
    ...(county === undefined ? {} : { county }),
    ...(postalCode === undefined ? {} : { postalCode }),
  }
}

const partyFrom = (value: Row, prefix: string): PartySnapshot => ({
  legalName: text(value, `${prefix}legal_name`),
  taxIdentifier: text(value, `${prefix}tax_identifier`),
  address: addressFrom(value, prefix),
})

const customerFrom = (value: Row): Customer => {
  const deletedAt = optionalText(value, "deleted_at")
  return {
    ...partyFrom(value, ""),
    id: text(value, "id"),
    organizationId: text(value, "organization_id"),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  }
}

const documentSeriesFrom = (value: Row): DocumentSeries => ({
  organizationId: text(value, "organization_id"),
  documentType: text(value, "document_type") as DocumentSeries["documentType"],
  series: text(value, "series"),
})

const addressValues = (address: Address): ReadonlyArray<string | null> => [
  address.countryCode,
  address.city,
  address.street,
  address.county ?? null,
  address.postalCode ?? null,
]

const paymentFrom = (value: Row) => {
  const externalReference = optionalText(value, "external_reference")
  const note = optionalText(value, "note")
  return {
    id: text(value, "id"),
    invoiceId: text(value, "invoice_id"),
    organizationId: text(value, "organization_id"),
    amount: text(value, "amount"),
    currency: text(value, "currency"),
    paymentDate: text(value, "payment_date"),
    method: text(value, "method"),
    ...(externalReference === undefined ? {} : { externalReference }),
    ...(note === undefined ? {} : { note }),
    actorId: text(value, "actor_id"),
    createdAt: text(value, "created_at"),
  }
}

const lineFrom = (value: Row): DraftLine => ({
  id: text(value, "id"),
  description: text(value, "description"),
  quantity: text(value, "quantity"),
  unitPrice: text(value, "unit_price"),
  taxCode: text(value, "tax_code"),
  taxCategory: "standard",
  taxRate: text(value, "tax_rate"),
  totalExcludingTax: text(value, "total_excluding_tax"),
  taxAmount: text(value, "tax_amount"),
  totalIncludingTax: text(value, "total_including_tax"),
})

const saveLines = (database: DatabaseSync, table: "draft_lines" | "issued_lines", parentId: string, lines: ReadonlyArray<DraftLine>) => {
  const parentColumn = table === "draft_lines" ? "draft_id" : "invoice_id"
  const idColumns = table === "draft_lines" ? "id, draft_id" : "id, invoice_id"
  database.prepare(`DELETE FROM ${table} WHERE ${parentColumn} = ?`).run(parentId)
  const statement = database.prepare(`INSERT INTO ${table}
    (${idColumns}, line_position, description, quantity, unit_price, tax_code, tax_category,
      tax_rate, total_excluding_tax, tax_amount, total_including_tax)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  lines.forEach((line, position) => statement.run(
    line.id, parentId, position, line.description, line.quantity, line.unitPrice,
    line.taxCode, line.taxCategory, line.taxRate, line.totalExcludingTax,
    line.taxAmount, line.totalIncludingTax,
  ))
}

const loadLines = (database: DatabaseSync, table: "draft_lines" | "issued_lines", parentId: string): ReadonlyArray<DraftLine> => {
  const parentColumn = table === "draft_lines" ? "draft_id" : "invoice_id"
  return database.prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? ORDER BY line_position`).all(parentId)
    .map((value) => lineFrom(value as Row))
}

const issuedInvoiceFrom = (database: DatabaseSync, value: Row): IssuedInvoice => {
  const id = text(value, "id")
  const taxBreakdown: ReadonlyArray<TaxBreakdown> = database.prepare(
    "SELECT * FROM issued_tax_breakdown WHERE invoice_id = ? ORDER BY line_position",
  ).all(id).map((item) => {
    const tax = item as Row
    return {
      taxCode: text(tax, "tax_code"), category: "standard", rate: text(tax, "rate"),
      taxableAmount: text(tax, "taxable_amount"), taxAmount: text(tax, "tax_amount"),
    }
  })
  return {
    id, draftId: text(value, "draft_id"), organizationId: text(value, "organization_id"),
    series: text(value, "series"), number: integer(value, "number"),
    issueDate: text(value, "issue_date"), dueDate: text(value, "due_date"),
    issuedAt: text(value, "issued_at"), currency: text(value, "currency"),
    issuer: partyFrom(value, "issuer_"), customer: partyFrom(value, "customer_"),
    lines: loadLines(database, "issued_lines", id), taxBreakdown,
    totalExcludingTax: text(value, "total_excluding_tax"), taxTotal: text(value, "tax_total"),
    totalIncludingTax: text(value, "total_including_tax"),
    eFacturaStatus: (optionalText(value, "e_factura_status") ?? "not_sent") as IssuedInvoice["eFacturaStatus"],
  }
}

const transactionAdapter = (database: DatabaseSync): InvoicingTransaction => ({
  saveIssuer: (issuer) => write("save issuer", () => {
    database.prepare(`INSERT INTO issuers
      (organization_id, legal_name, tax_identifier, country_code, city, street, county, postal_code,
       default_currency, default_payment_term_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (organization_id) DO UPDATE SET legal_name=excluded.legal_name,
       tax_identifier=excluded.tax_identifier, country_code=excluded.country_code, city=excluded.city,
       street=excluded.street, county=excluded.county, postal_code=excluded.postal_code,
        default_currency=excluded.default_currency, default_payment_term_days=excluded.default_payment_term_days`)
      .run(issuer.organizationId, issuer.legalName, issuer.taxIdentifier, ...addressValues(issuer.address),
        issuer.defaultCurrency, issuer.defaultPaymentTermDays)
    database.prepare("DELETE FROM issuer_tax_configurations WHERE organization_id = ?").run(issuer.organizationId)
    const statement = database.prepare(`INSERT INTO issuer_tax_configurations
      (organization_id, code, category, rate, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?)`)
    issuer.taxConfigurations.forEach((tax) => statement.run(
      issuer.organizationId, tax.code, tax.category, tax.rate, tax.effectiveFrom, tax.effectiveTo ?? null,
    ))
  }),
  findIssuer: (organizationId) => read("find issuer", () => {
    const value = row(database.prepare("SELECT * FROM issuers WHERE organization_id = ?").get(organizationId))
    if (value === undefined) return undefined
    const taxConfigurations: ReadonlyArray<TaxConfiguration> = database.prepare(
      "SELECT * FROM issuer_tax_configurations WHERE organization_id = ? ORDER BY code, effective_from",
    ).all(organizationId).map((item) => {
      const tax = item as Row
      const effectiveTo = optionalText(tax, "effective_to")
      return {
        code: text(tax, "code"), category: "standard", rate: text(tax, "rate"),
        effectiveFrom: text(tax, "effective_from"),
        ...(effectiveTo === undefined ? {} : { effectiveTo }),
      }
    })
    return {
      ...partyFrom(value, ""), organizationId, defaultCurrency: text(value, "default_currency"),
      defaultPaymentTermDays: integer(value, "default_payment_term_days"), taxConfigurations,
    }
  }),
  addDocumentSeries: (documentSeries) => write("add document series", () => {
    const existing = database.prepare(`SELECT 1 FROM document_series
      WHERE organization_id = ? AND document_type = ? AND series = ?`).get(
      documentSeries.organizationId, documentSeries.documentType, documentSeries.series,
    )
    if (existing !== undefined) {
      throw new DomainConflict({ code: "document_series_exists", message: "Document series already exists" })
    }
    database.prepare(`INSERT INTO document_series (organization_id, document_type, series)
      VALUES (?, ?, ?)`).run(documentSeries.organizationId, documentSeries.documentType, documentSeries.series)
  }),
  findDocumentSeries: (organizationId, documentType, series) => read("find document series", () => {
    const value = row(database.prepare(`SELECT * FROM document_series
      WHERE organization_id = ? AND document_type = ? AND series = ?`).get(organizationId, documentType, series))
    return value === undefined ? undefined : documentSeriesFrom(value)
  }),
  listDocumentSeries: (organizationId) => read("list document series", () =>
    database.prepare(`SELECT * FROM document_series WHERE organization_id = ?
      ORDER BY document_type, series`).all(organizationId).map((value) => documentSeriesFrom(value as Row))),
  saveCustomer: (customer) => write("save customer", () => {
    const result = database.prepare(`INSERT INTO customers
      (id, organization_id, legal_name, tax_identifier, country_code, city, street, county, postal_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET legal_name=excluded.legal_name, tax_identifier=excluded.tax_identifier,
       country_code=excluded.country_code, city=excluded.city, street=excluded.street,
       county=excluded.county, postal_code=excluded.postal_code
      WHERE customers.organization_id=excluded.organization_id`)
      .run(customer.id, customer.organizationId, customer.legalName, customer.taxIdentifier, ...addressValues(customer.address))
    if (result.changes === 0) throw new DomainConflict({ code: "customer_id_taken", message: "Customer id belongs to another organization" })
  }),
  findCustomer: (organizationId, id) => read("find customer", () => {
    const value = row(database.prepare("SELECT * FROM customers WHERE organization_id = ? AND id = ?").get(organizationId, id))
    return value === undefined ? undefined : customerFrom(value)
  }),
  listCustomers: (organizationId) => read("list customers", () =>
    database.prepare(`SELECT * FROM customers
      WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY legal_name COLLATE NOCASE, id LIMIT 100`).all(organizationId).map((value) => customerFrom(value as Row))),
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
  saveDraft: (draft) => write("save draft", () => {
    const result = database.prepare(`INSERT INTO invoice_drafts
      (id, organization_id, customer_id, series, issue_date, due_date, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET customer_id=excluded.customer_id, series=excluded.series, issue_date=excluded.issue_date,
       due_date=excluded.due_date, currency=excluded.currency, status=excluded.status
      WHERE invoice_drafts.organization_id=excluded.organization_id`)
      .run(draft.id, draft.organizationId, draft.customerId, draft.series, draft.issueDate, draft.dueDate, draft.currency, draft.status)
    if (result.changes === 0) throw new DomainConflict({ code: "draft_id_taken", message: "Draft id belongs to another organization" })
    saveLines(database, "draft_lines", draft.id, draft.lines)
  }),
  findDraft: (organizationId, id) => read("find draft", () => {
    const value = row(database.prepare("SELECT * FROM invoice_drafts WHERE organization_id = ? AND id = ?").get(organizationId, id))
    if (value === undefined) return undefined
    return {
      id, organizationId, customerId: text(value, "customer_id"), series: text(value, "series"), issueDate: text(value, "issue_date"),
      dueDate: text(value, "due_date"), currency: text(value, "currency"),
      status: text(value, "status") === "issued" ? "issued" : "draft", lines: loadLines(database, "draft_lines", id),
    }
  }),
  allocateInvoiceNumber: (organizationId, fiscalYear, series) => write("allocate invoice number", () => {
    const value = row(database.prepare(`INSERT INTO invoice_sequences
      (organization_id, fiscal_year, document_type, series, last_number) VALUES (?, ?, 'invoice', ?, 1)
      ON CONFLICT (organization_id, fiscal_year, document_type, series)
      DO UPDATE SET last_number=last_number+1 RETURNING last_number`).get(organizationId, fiscalYear, series))
    if (value === undefined) throw new Error("missing allocated number")
    return integer(value, "last_number")
  }),
  saveIssuedInvoice: (invoice) => write("save issued invoice", () => {
    database.prepare(`INSERT INTO issued_invoices
      (id, draft_id, organization_id, fiscal_year, document_type, series, number, issue_date, due_date,
       issued_at, currency, issuer_legal_name, issuer_tax_identifier, issuer_country_code, issuer_city,
       issuer_street, issuer_county, issuer_postal_code, customer_legal_name, customer_tax_identifier,
       customer_country_code, customer_city, customer_street, customer_county, customer_postal_code,
       total_excluding_tax, tax_total, total_including_tax, e_factura_status)
      VALUES (?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(invoice.id, invoice.draftId, invoice.organizationId, Number(invoice.issueDate.slice(0, 4)),
        invoice.series, invoice.number, invoice.issueDate, invoice.dueDate, invoice.issuedAt, invoice.currency,
        invoice.issuer.legalName, invoice.issuer.taxIdentifier, ...addressValues(invoice.issuer.address),
        invoice.customer.legalName, invoice.customer.taxIdentifier, ...addressValues(invoice.customer.address),
        invoice.totalExcludingTax, invoice.taxTotal, invoice.totalIncludingTax, (invoice as unknown as { eFacturaStatus?: string }).eFacturaStatus ?? "not_sent")
    saveLines(database, "issued_lines", invoice.id, invoice.lines)
    const statement = database.prepare(`INSERT INTO issued_tax_breakdown
      (invoice_id, line_position, tax_code, category, rate, taxable_amount, tax_amount) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    invoice.taxBreakdown.forEach((tax, position) => statement.run(
      invoice.id, position, tax.taxCode, tax.category, tax.rate, tax.taxableAmount, tax.taxAmount,
    ))
  }),
  findIssuedInvoice: (organizationId, id) => read("find issued invoice", () => {
    const value = row(database.prepare("SELECT * FROM issued_invoices WHERE organization_id = ? AND id = ?").get(organizationId, id))
    return value === undefined ? undefined : issuedInvoiceFrom(database, value)
  }),
  listIssuedInvoices: (organizationId) => read("list issued invoices", () =>
    database.prepare(`SELECT * FROM issued_invoices WHERE organization_id = ?
      ORDER BY issue_date DESC, number DESC, id LIMIT 100`).all(organizationId)
      .map((value) => issuedInvoiceFrom(database, value as Row))),
  savePayment: (payment) => write("save payment", () => {
    const result = database.prepare(`INSERT INTO invoice_payments
      (id, invoice_id, organization_id, amount, currency, payment_date, method, external_reference, note, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(payment.id, payment.invoiceId, payment.organizationId, payment.amount, payment.currency,
        payment.paymentDate, payment.method, payment.externalReference ?? null, payment.note ?? null,
        payment.actorId, payment.createdAt)
    if (result.changes === 0) throw new DomainConflict({ code: "payment_not_saved", message: "Payment could not be saved" })
  }),
  listPayments: (organizationId, invoiceId) => read("list payments", () =>
    database.prepare("SELECT * FROM invoice_payments WHERE organization_id = ? AND invoice_id = ? ORDER BY payment_date, created_at, id")
      .all(organizationId, invoiceId).map((value) => paymentFrom(value as Row))),
  allocateCorrectionNumber: (organizationId, fiscalYear, series) => write("allocate correction number", () => {
    const value = row(database.prepare(`INSERT INTO invoice_sequences
      (organization_id, fiscal_year, document_type, series, last_number) VALUES (?, ?, 'correction', ?, 1)
      ON CONFLICT (organization_id, fiscal_year, document_type, series)
      DO UPDATE SET last_number=last_number+1 RETURNING last_number`).get(organizationId, fiscalYear, series))
    if (value === undefined) throw new Error("missing allocated number")
    return integer(value, "last_number")
  }),
  saveCorrection: (correction) => write("save correction", () => {
    database.prepare(`INSERT INTO correction_documents
      (id, organization_id, original_invoice_id, fiscal_year, document_type, series, number, issue_date, issued_at, reason, currency,
       issuer_legal_name, issuer_tax_identifier, issuer_country_code, issuer_city, issuer_street, issuer_county, issuer_postal_code,
       customer_legal_name, customer_tax_identifier, customer_country_code, customer_city, customer_street, customer_county, customer_postal_code,
       total_excluding_tax, tax_total, total_including_tax)
      VALUES (?, ?, ?, ?, 'correction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(correction.id, correction.organizationId, correction.originalInvoiceId, correction.fiscalYear,
        correction.series, correction.number, correction.issueDate, correction.issuedAt, correction.reason, correction.currency,
        correction.issuer.legalName, correction.issuer.taxIdentifier, ...addressValues(correction.issuer.address),
        correction.customer.legalName, correction.customer.taxIdentifier, ...addressValues(correction.customer.address),
        correction.totalExcludingTax, correction.taxTotal, correction.totalIncludingTax)
    const lineStmt = database.prepare(`INSERT INTO correction_lines
      (id, correction_id, line_position, description, quantity, unit_price, tax_code, tax_category, tax_rate, total_excluding_tax, tax_amount, total_including_tax)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    correction.lines.forEach((line, pos) => lineStmt.run(line.id, correction.id, pos, line.description, line.quantity, line.unitPrice, line.taxCode, line.taxCategory, line.taxRate, line.totalExcludingTax, line.taxAmount, line.totalIncludingTax))
    const taxStmt = database.prepare(`INSERT INTO correction_tax_breakdown
      (correction_id, line_position, tax_code, category, rate, taxable_amount, tax_amount) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    correction.taxBreakdown.forEach((tax, pos) => taxStmt.run(correction.id, pos, tax.taxCode, tax.category, tax.rate, tax.taxableAmount, tax.taxAmount))
  }),
  findCorrection: (organizationId, id) => read("find correction", () => {
    const value = row(database.prepare("SELECT * FROM correction_documents WHERE organization_id = ? AND id = ?").get(organizationId, id))
    if (value === undefined) return undefined
    const lines: ReadonlyArray<DraftLine> = database.prepare("SELECT * FROM correction_lines WHERE correction_id = ? ORDER BY line_position").all(id).map((v) => lineFrom(v as Row))
    const taxBreakdown: ReadonlyArray<TaxBreakdown> = database.prepare("SELECT * FROM correction_tax_breakdown WHERE correction_id = ? ORDER BY line_position").all(id).map((item) => {
      const tax = item as Row
      return { taxCode: text(tax, "tax_code"), category: "standard", rate: text(tax, "rate"), taxableAmount: text(tax, "taxable_amount"), taxAmount: text(tax, "tax_amount") }
    })
    return {
      id, organizationId, originalInvoiceId: text(value, "original_invoice_id"), fiscalYear: integer(value, "fiscal_year"), series: text(value, "series"), number: integer(value, "number"),
      issueDate: text(value, "issue_date"), issuedAt: text(value, "issued_at"), reason: text(value, "reason"), currency: text(value, "currency"),
      issuer: partyFrom(value, "issuer_"), customer: partyFrom(value, "customer_"), lines, taxBreakdown,
      totalExcludingTax: text(value, "total_excluding_tax"), taxTotal: text(value, "tax_total"), totalIncludingTax: text(value, "total_including_tax"),
    }
  }),
  listCorrections: (organizationId, originalInvoiceId) => read("list corrections", () => {
    const rows = database.prepare("SELECT * FROM correction_documents WHERE organization_id = ? AND original_invoice_id = ? ORDER BY issued_at, number, id").all(organizationId, originalInvoiceId) as ReadonlyArray<Row>
    return rows.map((value) => {
      const id = text(value, "id")
      const lines: ReadonlyArray<DraftLine> = database.prepare("SELECT * FROM correction_lines WHERE correction_id = ? ORDER BY line_position").all(id).map((v) => lineFrom(v as Row))
      const taxBreakdown: ReadonlyArray<TaxBreakdown> = database.prepare("SELECT * FROM correction_tax_breakdown WHERE correction_id = ? ORDER BY line_position").all(id).map((item) => {
        const tax = item as Row
        return { taxCode: text(tax, "tax_code"), category: "standard", rate: text(tax, "rate"), taxableAmount: text(tax, "taxable_amount"), taxAmount: text(tax, "tax_amount") }
      })
      return {
        id, organizationId, originalInvoiceId: text(value, "original_invoice_id"), fiscalYear: integer(value, "fiscal_year"), series: text(value, "series"), number: integer(value, "number"),
        issueDate: text(value, "issue_date"), issuedAt: text(value, "issued_at"), reason: text(value, "reason"), currency: text(value, "currency"),
        issuer: partyFrom(value, "issuer_"), customer: partyFrom(value, "customer_"), lines, taxBreakdown,
        totalExcludingTax: text(value, "total_excluding_tax"), taxTotal: text(value, "tax_total"), totalIncludingTax: text(value, "total_including_tax"),
      }
    })
  }),
  getMaxInvoiceNumber: (organizationId, fiscalYear, series) => read("get max invoice number", () => {
    const value = row(database.prepare("SELECT MAX(number) as max_number FROM issued_invoices WHERE organization_id = ? AND fiscal_year = ? AND document_type = 'invoice' AND series = ?").get(organizationId, fiscalYear, series))
    const max = value?.max_number
    return typeof max === "number" ? max : undefined
  }),
  revertDraftToDraft: (organizationId, draftId) => write("revert draft", () => {
    const result = database.prepare("UPDATE invoice_drafts SET status = 'draft' WHERE organization_id = ? AND id = ? AND status = 'issued'").run(organizationId, draftId)
    if (result.changes === 0) throw new DomainConflict({ code: "draft_not_issued", message: "Draft is not issued" })
  }),
  deleteIssuedInvoice: (organizationId, id) => write("delete issued invoice", () => {
    const inv = row(database.prepare("SELECT * FROM issued_invoices WHERE organization_id = ? AND id = ?").get(organizationId, id))
    if (inv === undefined) throw new DomainConflict({ code: "invoice_not_found", message: "Invoice not found" })
    const fiscalYear = integer(inv, "fiscal_year")
    const series = text(inv, "series")
    const number = integer(inv, "number")
    database.prepare("DELETE FROM issued_tax_breakdown WHERE invoice_id = ?").run(id)
    database.prepare("DELETE FROM issued_lines WHERE invoice_id = ?").run(id)
    database.prepare("DELETE FROM invoice_payments WHERE invoice_id = ? AND organization_id = ?").run(id, organizationId)
    const del = database.prepare("DELETE FROM issued_invoices WHERE organization_id = ? AND id = ?").run(organizationId, id)
    if (del.changes === 0) throw new DomainConflict({ code: "invoice_not_deleted", message: "Invoice could not be deleted" })
    const seq = row(database.prepare("SELECT last_number FROM invoice_sequences WHERE organization_id = ? AND fiscal_year = ? AND document_type = 'invoice' AND series = ?").get(organizationId, fiscalYear, series))
    if (seq !== undefined && integer(seq, "last_number") === number) {
      database.prepare("UPDATE invoice_sequences SET last_number = last_number - 1 WHERE organization_id = ? AND fiscal_year = ? AND document_type = 'invoice' AND series = ?").run(organizationId, fiscalYear, series)
      const updated = row(database.prepare("SELECT last_number FROM invoice_sequences WHERE organization_id = ? AND fiscal_year = ? AND document_type = 'invoice' AND series = ?").get(organizationId, fiscalYear, series))
      if (updated !== undefined && integer(updated, "last_number") === 0) {
        database.prepare("DELETE FROM invoice_sequences WHERE organization_id = ? AND fiscal_year = ? AND document_type = 'invoice' AND series = ?").run(organizationId, fiscalYear, series)
      }
    }
  }),
})

export const createSqliteStore = (dataDirectory: string): TransactionalStore<InvoicingTransaction> => ({
  transaction: (use) => Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        const database = new DatabaseSync(databasePath(dataDirectory))
        database.exec("PRAGMA foreign_keys = ON")
        database.exec("BEGIN IMMEDIATE")
        const handle: TransactionHandle = { database, open: true }
        return handle
      },
      catch: () => persistence("begin transaction"),
    }),
    (handle) => Effect.tap(use(transactionAdapter(handle.database)), () => Effect.try({
      try: () => {
        handle.database.exec("COMMIT")
        handle.open = false
      },
      catch: () => persistence("commit transaction"),
    })),
    (handle) => Effect.sync(() => {
      if (handle.open) {
        try { handle.database.exec("ROLLBACK") } catch { /* original failure wins */ }
      }
      handle.database.close()
    }),
  ),
})
