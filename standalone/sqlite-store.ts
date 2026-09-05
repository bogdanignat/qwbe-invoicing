import { DatabaseSync } from "node:sqlite"

import { Effect } from "effect"

import {
  DomainConflict,
  calculateTotals,
  PersistenceFailure,
  type Address,
  type BuyerSnapshot,
  type Customer,
  type DraftInvoice,
  type DraftLine,
  type DocumentSeries,
  type DocumentSource,
  type IdempotencyRecord,
  type InvoicingTransaction,
  type IssuedInvoice,
  type PartySnapshot,
  type ProductPreset,
  type Proforma,
  type TaxBreakdown,
  type TaxConfiguration,
  type TransactionalStore,
} from "../cube/invoicing/index.ts"
import {
  DomainConflict as PaymentsDomainConflict,
  PersistenceFailure as PaymentsPersistenceFailure,
  type Payment,
  type PaymentsTransaction,
  type TransactionalStore as PaymentsStore,
} from "../cube/payments/index.ts"
import { databasePath } from "./migrations.ts"

type WriteFailure = DomainConflict | PersistenceFailure
type Row = Readonly<Record<string, unknown>>

interface TransactionHandle {
  readonly database: DatabaseSync
  open: boolean
  closed: boolean
}

const persistence = (operation: string) => new PersistenceFailure({ operation })

const writeFailure = (error: unknown, operation: string): WriteFailure => {
  if (error instanceof DomainConflict) return error
  if (typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT")) {
    return operation === "save proforma invoice conversion"
      ? new DomainConflict({ code: "proforma_already_converted", message: "Proforma was already converted" })
      : new DomainConflict({ code: "persistence_conflict", message: `Conflict while performing ${operation}` })
  }
  return persistence(operation)
}

const write = <Value>(operation: string, run: () => Value): Effect.Effect<Value, WriteFailure> =>
  Effect.try({ try: run, catch: (error) => writeFailure(error, operation) })

const read = <Value>(operation: string, run: () => Value): Effect.Effect<Value, PersistenceFailure> =>
  Effect.try({ try: run, catch: () => persistence(operation) })

const paymentsPersistence = (operation: string) => new PaymentsPersistenceFailure({ operation })
const paymentWrite = <Value>(operation: string, run: () => Value): Effect.Effect<
  Value,
  PaymentsDomainConflict | PaymentsPersistenceFailure
> => Effect.try({
  try: run,
  catch: (error) => typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT")
    ? new PaymentsDomainConflict({ code: "persistence_conflict", message: `Conflict while performing ${operation}` })
    : paymentsPersistence(operation),
})
const paymentRead = <Value>(operation: string, run: () => Value): Effect.Effect<Value, PaymentsPersistenceFailure> =>
  Effect.try({ try: run, catch: () => paymentsPersistence(operation) })

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

const nullableText = (value: Row, field: string): string | null => optionalText(value, field) ?? null

const integer = (value: Row, field: string): number => {
  const result = value[field]
  if (typeof result !== "number" || !Number.isInteger(result)) throw new Error(`invalid ${field}`)
  return result
}

const optionalInteger = (value: Row, field: string): number | undefined => {
  const result = value[field]
  if (result === null || result === undefined) return undefined
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

const buyerFrom = (value: Row, prefix: string): BuyerSnapshot => ({
  ...partyFrom(value, prefix),
  partyType: text(value, `${prefix}party_type`) as BuyerSnapshot["partyType"],
})

const sourceFrom = (value: Row) => {
  const app = optionalText(value, "source_app")
  const kind = optionalText(value, "source_kind")
  const id = optionalText(value, "source_id")
  if (app === undefined && kind === undefined && id === undefined) return undefined
  if (app === undefined || kind === undefined || id === undefined) throw new Error("invalid document source")
  return { app, kind, id }
}

const sourceValues = (source: DocumentSource | undefined): ReadonlyArray<string | null> =>
  source === undefined ? [null, null, null] : [source.app, source.kind, source.id]

const sourceFilter = (source: DocumentSource | undefined, prefix = "") => source === undefined
  ? { sql: "", values: [] as ReadonlyArray<string> }
  : { sql: ` AND ${prefix}source_app=? AND ${prefix}source_kind=? AND ${prefix}source_id=?`, values: [source.app, source.kind, source.id] }

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

const productPresetFrom = (value: Row): ProductPreset => ({
  id: text(value, "id"),
  organizationId: text(value, "organization_id"),
  description: text(value, "description"),
  unitPrice: text(value, "unit_price"),
  unitOfMeasure: { code: text(value, "unit_code"), name: text(value, "unit_name") },
})

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

const paymentFrom = (value: Row): Payment => {
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
  unitOfMeasure: { code: text(value, "unit_code"), name: text(value, "unit_name") },
  taxCode: text(value, "tax_code"),
  taxCategory: "standard",
  taxRate: text(value, "tax_rate"),
  totalExcludingTax: text(value, "total_excluding_tax"),
  taxAmount: text(value, "tax_amount"),
  totalIncludingTax: text(value, "total_including_tax"),
})

type LineTable = "draft_lines" | "issued_lines" | "proforma_lines"
type LineTarget = { readonly table: "draft_lines" | "issued_lines" }
  | { readonly table: "proforma_lines"; readonly organizationId: string }
const lineParent = (table: LineTable) => table === "draft_lines" ? "draft_id" : table === "issued_lines" ? "invoice_id" : "proforma_id"
const saveLines = (database: DatabaseSync, target: LineTarget, parentId: string, lines: ReadonlyArray<DraftLine>) => {
  const { table } = target
  const parentColumn = lineParent(table)
  const scoped = table === "proforma_lines"
  const idColumns = `id, ${parentColumn}${scoped ? ", organization_id" : ""}`
  database.prepare(`DELETE FROM ${table} WHERE ${parentColumn} = ?`).run(parentId)
  const statement = database.prepare(`INSERT INTO ${table}
    (${idColumns}, line_position, description, quantity, unit_price, unit_code, unit_name, tax_code, tax_category,
      tax_rate, total_excluding_tax, tax_amount, total_including_tax)
    VALUES (?, ?, ${scoped ? "?, " : ""}?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  lines.forEach((line, position) => statement.run(
    line.id, parentId, ...(target.table === "proforma_lines" ? [target.organizationId] : []), position, line.description, line.quantity, line.unitPrice,
    line.unitOfMeasure.code, line.unitOfMeasure.name,
    line.taxCode, line.taxCategory, line.taxRate, line.totalExcludingTax,
    line.taxAmount, line.totalIncludingTax,
  ))
}

const loadLines = (database: DatabaseSync, table: LineTable, parentId: string): ReadonlyArray<DraftLine> => {
  const parentColumn = lineParent(table)
  return database.prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? ORDER BY line_position`).all(parentId)
    .map((value) => lineFrom(value as Row))
}

const issuedInvoiceFrom = (database: DatabaseSync, value: Row): IssuedInvoice => {
  const id = text(value, "id")
  const source = sourceFrom(value)
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
    id, draftId: nullableText(value, "draft_id"), sourceProformaId: nullableText(value, "source_proforma_id"),
    organizationId: text(value, "organization_id"),
    ...(source === undefined ? {} : { source }),
    series: text(value, "series"), number: integer(value, "number"),
    issueDate: text(value, "issue_date"), dueDate: nullableText(value, "due_date"),
    issuedAt: text(value, "issued_at"), currency: text(value, "currency"),
    issuer: partyFrom(value, "issuer_"), customer: buyerFrom(value, "customer_"),
    lines: loadLines(database, "issued_lines", id), taxBreakdown,
    totalExcludingTax: text(value, "total_excluding_tax"), taxTotal: text(value, "tax_total"),
    totalIncludingTax: text(value, "total_including_tax"),
    eFacturaStatus: (optionalText(value, "e_factura_status") ?? "not_sent") as IssuedInvoice["eFacturaStatus"],
  }
}

const taxFrom = (database: DatabaseSync, table: "proforma_tax_breakdown", parentColumn: "proforma_id", id: string): ReadonlyArray<TaxBreakdown> =>
  database.prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? ORDER BY line_position`).all(id).map((item) => {
    const tax = item as Row
    return { taxCode: text(tax, "tax_code"), category: "standard", rate: text(tax, "rate"),
      taxableAmount: text(tax, "taxable_amount"), taxAmount: text(tax, "tax_amount") }
  })

const proformaFrom = (database: DatabaseSync, value: Row): Proforma => {
  const id = text(value, "id")
  const source = sourceFrom(value)
  return {
    id, sourceDraftId: nullableText(value, "source_draft_id"), organizationId: text(value, "organization_id"),
    ...(source === undefined ? {} : { source }),
    invoiceSeries: text(value, "invoice_series"),
    convertedDraftId: nullableText(value, "converted_draft_id"),
    convertedInvoiceId: nullableText(value, "converted_invoice_id"),
    series: text(value, "series"), number: integer(value, "number"), issueDate: text(value, "issue_date"),
    dueDate: nullableText(value, "due_date"), issuedAt: text(value, "issued_at"), currency: text(value, "currency"),
    issuer: partyFrom(value, "issuer_"), customer: buyerFrom(value, "customer_"),
    lines: loadLines(database, "proforma_lines", id), taxBreakdown: taxFrom(database, "proforma_tax_breakdown", "proforma_id", id),
    totalExcludingTax: text(value, "total_excluding_tax"), taxTotal: text(value, "tax_total"),
    totalIncludingTax: text(value, "total_including_tax"),
  }
}

const draftStatus = (value: Row): DraftInvoice["status"] => {
  switch (text(value, "status")) {
    case "draft": return "draft"
    case "issued": return "issued"
    case "proforma_issued": return "proforma_issued"
    default: throw new Error("invalid status")
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
      (id, organization_id, party_type, legal_name, tax_identifier, country_code, city, street, county, postal_code, default_payment_term_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET party_type=excluded.party_type, legal_name=excluded.legal_name, tax_identifier=excluded.tax_identifier,
      country_code=excluded.country_code, city=excluded.city, street=excluded.street,
       county=excluded.county, postal_code=excluded.postal_code, default_payment_term_days=excluded.default_payment_term_days
      WHERE customers.organization_id=excluded.organization_id`)
      .run(customer.id, customer.organizationId, customer.partyType, customer.legalName, customer.taxIdentifier,
        ...addressValues(customer.address), customer.defaultPaymentTermDays ?? null)
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
  saveProductPreset: (preset) => write("save product preset", () => {
    const result = database.prepare(`INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET description=excluded.description,unit_price=excluded.unit_price,
       unit_code=excluded.unit_code,unit_name=excluded.unit_name
      WHERE product_presets.organization_id=excluded.organization_id`)
      .run(preset.id, preset.organizationId, preset.description, preset.unitPrice,
        preset.unitOfMeasure.code, preset.unitOfMeasure.name)
    if (result.changes === 0) throw new DomainConflict({ code: "product_preset_id_taken", message: "Product preset id belongs to another organization" })
  }),
  findProductPreset: (organizationId, id) => read("find product preset", () => {
    const value = row(database.prepare("SELECT * FROM product_presets WHERE organization_id=? AND id=?").get(organizationId, id))
    return value === undefined ? undefined : productPresetFrom(value)
  }),
  listProductPresets: (organizationId) => read("list product presets", () =>
    database.prepare(`SELECT * FROM product_presets WHERE organization_id=?
      ORDER BY description COLLATE NOCASE,id LIMIT 100`).all(organizationId).map((value) => productPresetFrom(value as Row))),
  deleteProductPreset: (organizationId, id) => write("delete product preset", () => {
    database.prepare("DELETE FROM product_presets WHERE organization_id=? AND id=?").run(organizationId, id)
  }),
  saveDraft: (draft) => write("save draft", () => {
    const result = database.prepare(`INSERT INTO invoice_drafts
      (id, organization_id, source_app, source_kind, source_id, customer_id, customer_party_type, customer_legal_name, customer_tax_identifier,
       customer_country_code, customer_city, customer_street, customer_county, customer_postal_code,
        series, issue_date, due_date, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET source_app=excluded.source_app,source_kind=excluded.source_kind,source_id=excluded.source_id,
       customer_id=excluded.customer_id, customer_party_type=excluded.customer_party_type,
       customer_legal_name=excluded.customer_legal_name, customer_tax_identifier=excluded.customer_tax_identifier,
       customer_country_code=excluded.customer_country_code, customer_city=excluded.customer_city,
       customer_street=excluded.customer_street, customer_county=excluded.customer_county,
       customer_postal_code=excluded.customer_postal_code, issue_date=excluded.issue_date,
       due_date=excluded.due_date, currency=excluded.currency, status=excluded.status
       WHERE invoice_drafts.organization_id=excluded.organization_id`)
      .run(draft.id, draft.organizationId, ...sourceValues(draft.source), draft.customerId ?? null, draft.customer.partyType,
        draft.customer.legalName, draft.customer.taxIdentifier, ...addressValues(draft.customer.address),
        draft.series, draft.issueDate, draft.dueDate, draft.currency, draft.status)
    if (result.changes === 0) throw new DomainConflict({ code: "draft_id_taken", message: "Draft id belongs to another organization" })
    saveLines(database, { table: "draft_lines" }, draft.id, draft.lines)
  }),
  findDraft: (organizationId, id) => read("find draft", () => {
    const value = row(database.prepare("SELECT * FROM invoice_drafts WHERE organization_id = ? AND id = ?").get(organizationId, id))
    if (value === undefined) return undefined
    const customerId = optionalText(value, "customer_id")
    const documentSource = sourceFrom(value)
    const lines = loadLines(database, "draft_lines", id)
    return {
      id, organizationId, ...(documentSource === undefined ? {} : { source: documentSource }),
      ...(customerId === undefined ? {} : { customerId }), customer: buyerFrom(value, "customer_"),
      series: text(value, "series"), issueDate: text(value, "issue_date"),
      dueDate: nullableText(value, "due_date"), currency: text(value, "currency"),
      status: draftStatus(value), lines, ...calculateTotals(lines),
    }
  }),
  listDrafts: (organizationId, source) => read("list drafts", () => {
    const filter = sourceFilter(source)
    const values = database.prepare(`SELECT * FROM invoice_drafts WHERE organization_id = ? AND status = 'draft'${filter.sql}
      ORDER BY issue_date DESC, id LIMIT 100`).all(organizationId, ...filter.values) as ReadonlyArray<Row>
    return values.map((value) => {
      const id = text(value, "id")
      const customerId = optionalText(value, "customer_id")
      const lines = loadLines(database, "draft_lines", id)
      const documentSource = sourceFrom(value)
      return { id, organizationId, ...(documentSource === undefined ? {} : { source: documentSource }),
        ...(customerId === undefined ? {} : { customerId }), customer: buyerFrom(value, "customer_"),
        series: text(value, "series"), issueDate: text(value, "issue_date"), dueDate: nullableText(value, "due_date"),
        currency: text(value, "currency"), status: "draft" as const, lines, ...calculateTotals(lines) }
    })
  }),
  deleteDraft: (organizationId, id) => write("delete draft", () => {
    const result = database.prepare("DELETE FROM invoice_drafts WHERE organization_id = ? AND id = ? AND status = 'draft'")
      .run(organizationId, id)
    if (result.changes === 0) throw new DomainConflict({ code: "draft_not_editable", message: "Draft cannot be deleted" })
  }),
  allocateDocumentNumber: (organizationId, fiscalYear, documentType, series) => write("allocate document number", () => {
    const value = row(database.prepare(`INSERT INTO invoice_sequences
      (organization_id, fiscal_year, document_type, series, last_number) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (organization_id, fiscal_year, document_type, series)
      DO UPDATE SET last_number=last_number+1 RETURNING last_number`).get(organizationId, fiscalYear, documentType, series))
    if (value === undefined) throw new Error("missing allocated number")
    return integer(value, "last_number")
  }),
  saveIssuedInvoice: (invoice) => write("save issued invoice", () => {
    database.prepare(`INSERT INTO issued_invoices
      (id, draft_id, source_proforma_id, organization_id, source_app, source_kind, source_id, fiscal_year, document_type, series, number, issue_date, due_date,
       issued_at, currency, issuer_legal_name, issuer_tax_identifier, issuer_country_code, issuer_city,
        issuer_street, issuer_county, issuer_postal_code, customer_legal_name, customer_tax_identifier, customer_party_type,
       customer_country_code, customer_city, customer_street, customer_county, customer_postal_code,
       total_excluding_tax, tax_total, total_including_tax, e_factura_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(invoice.id, invoice.draftId, invoice.sourceProformaId, invoice.organizationId, ...sourceValues(invoice.source), Number(invoice.issueDate.slice(0, 4)),
        invoice.series, invoice.number, invoice.issueDate, invoice.dueDate, invoice.issuedAt, invoice.currency,
        invoice.issuer.legalName, invoice.issuer.taxIdentifier, ...addressValues(invoice.issuer.address),
        invoice.customer.legalName, invoice.customer.taxIdentifier, invoice.customer.partyType, ...addressValues(invoice.customer.address),
        invoice.totalExcludingTax, invoice.taxTotal, invoice.totalIncludingTax, (invoice as unknown as { eFacturaStatus?: string }).eFacturaStatus ?? "not_sent")
    saveLines(database, { table: "issued_lines" }, invoice.id, invoice.lines)
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
  listIssuedInvoices: (organizationId, source) => read("list issued invoices", () => {
    const filter = sourceFilter(source)
    return database.prepare(`SELECT * FROM issued_invoices WHERE organization_id = ?${filter.sql}
      ORDER BY issue_date DESC, number DESC, id LIMIT 100`).all(organizationId, ...filter.values)
      .map((value) => issuedInvoiceFrom(database, value as Row))
  }),
  saveProforma: (proforma) => write("save proforma", () => {
    database.prepare(`INSERT INTO proformas
      (id,source_draft_id,organization_id,source_app,source_kind,source_id,fiscal_year,document_type,series,invoice_series,number,issue_date,due_date,issued_at,currency,
       issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_postal_code,
       customer_party_type,customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_postal_code,
         total_excluding_tax,tax_total,total_including_tax) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(proforma.id, proforma.sourceDraftId, proforma.organizationId, ...sourceValues(proforma.source), Number(proforma.issueDate.slice(0, 4)), "proforma",
        proforma.series, proforma.invoiceSeries, proforma.number, proforma.issueDate, proforma.dueDate, proforma.issuedAt, proforma.currency,
        proforma.issuer.legalName, proforma.issuer.taxIdentifier, ...addressValues(proforma.issuer.address), proforma.customer.partyType,
        proforma.customer.legalName, proforma.customer.taxIdentifier, ...addressValues(proforma.customer.address),
        proforma.totalExcludingTax, proforma.taxTotal, proforma.totalIncludingTax)
    saveLines(database, { table: "proforma_lines", organizationId: proforma.organizationId }, proforma.id, proforma.lines)
    const statement = database.prepare(`INSERT INTO proforma_tax_breakdown
      (proforma_id,organization_id,line_position,tax_code,category,rate,taxable_amount,tax_amount) VALUES(?,?,?,?,?,?,?,?)`)
    proforma.taxBreakdown.forEach((tax, position) => statement.run(
      proforma.id, proforma.organizationId, position, tax.taxCode, tax.category, tax.rate, tax.taxableAmount, tax.taxAmount,
    ))
    database.prepare("UPDATE proformas SET sealed=1 WHERE id=? AND organization_id=? AND sealed=0")
      .run(proforma.id, proforma.organizationId)
  }),
  findProforma: (organizationId, id) => read("find proforma", () => {
    const value = row(database.prepare(`SELECT p.*,c.resulting_draft_id AS converted_draft_id,i.resulting_invoice_id AS converted_invoice_id FROM proformas p
      LEFT JOIN proforma_conversions c ON c.organization_id=p.organization_id AND c.proforma_id=p.id
      LEFT JOIN proforma_invoice_conversions i ON i.organization_id=p.organization_id AND i.proforma_id=p.id
      WHERE p.organization_id=? AND p.id=? AND p.sealed=1`).get(organizationId, id))
    return value === undefined ? undefined : proformaFrom(database, value)
  }),
  listProformas: (organizationId, source) => read("list proformas", () => {
    const filter = sourceFilter(source, "p.")
    return database.prepare(`SELECT p.*,c.resulting_draft_id AS converted_draft_id,i.resulting_invoice_id AS converted_invoice_id FROM proformas p
      LEFT JOIN proforma_conversions c ON c.organization_id=p.organization_id AND c.proforma_id=p.id
      LEFT JOIN proforma_invoice_conversions i ON i.organization_id=p.organization_id AND i.proforma_id=p.id
      WHERE p.organization_id=? AND p.sealed=1${filter.sql} ORDER BY p.issue_date DESC,p.number DESC,p.id LIMIT 100`)
      .all(organizationId, ...filter.values).map((value) => proformaFrom(database, value as Row))
  }),
  findProformaConversion: (organizationId, proformaId) => read("find proforma conversion", () => {
    const value = row(database.prepare("SELECT * FROM proforma_conversions WHERE organization_id=? AND proforma_id=?")
      .get(organizationId, proformaId))
    return value === undefined ? undefined : {
      proformaId: text(value, "proforma_id"), organizationId: text(value, "organization_id"),
      resultingDraftId: text(value, "resulting_draft_id"), actorId: text(value, "actor_id"),
      convertedAt: text(value, "converted_at"),
    }
  }),
  findProformaInvoiceConversion: (organizationId, proformaId) => read("find proforma invoice conversion", () => {
    const value = row(database.prepare("SELECT * FROM proforma_invoice_conversions WHERE organization_id=? AND proforma_id=?")
      .get(organizationId, proformaId))
    return value === undefined ? undefined : { proformaId: text(value, "proforma_id"), organizationId: text(value, "organization_id"),
      resultingInvoiceId: text(value, "resulting_invoice_id"), actorId: text(value, "actor_id"), convertedAt: text(value, "converted_at") }
  }),
  saveProformaInvoiceConversion: (conversion) => write("save proforma invoice conversion", () => {
    database.prepare(`INSERT INTO proforma_invoice_conversions(proforma_id,organization_id,resulting_invoice_id,actor_id,converted_at)
      VALUES(?,?,?,?,?)`).run(conversion.proformaId, conversion.organizationId, conversion.resultingInvoiceId,
        conversion.actorId, conversion.convertedAt)
  }),
  saveCorrection: (correction) => write("save correction", () => {
    database.prepare(`INSERT INTO correction_documents
      (id, organization_id, source_app, source_kind, source_id, original_invoice_id, fiscal_year, document_type, series, number, issue_date, issued_at, reason, currency,
       issuer_legal_name, issuer_tax_identifier, issuer_country_code, issuer_city, issuer_street, issuer_county, issuer_postal_code,
        customer_legal_name, customer_tax_identifier, customer_party_type, customer_country_code, customer_city, customer_street, customer_county, customer_postal_code,
       total_excluding_tax, tax_total, total_including_tax)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'correction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(correction.id, correction.organizationId, ...sourceValues(correction.source), correction.originalInvoiceId, correction.fiscalYear,
        correction.series, correction.number, correction.issueDate, correction.issuedAt, correction.reason, correction.currency,
        correction.issuer.legalName, correction.issuer.taxIdentifier, ...addressValues(correction.issuer.address),
        correction.customer.legalName, correction.customer.taxIdentifier, correction.customer.partyType, ...addressValues(correction.customer.address),
        correction.totalExcludingTax, correction.taxTotal, correction.totalIncludingTax)
    const lineStmt = database.prepare(`INSERT INTO correction_lines
      (id, correction_id, line_position, description, quantity, unit_price, unit_code, unit_name, tax_code, tax_category, tax_rate, total_excluding_tax, tax_amount, total_including_tax)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    correction.lines.forEach((line, pos) => lineStmt.run(line.id, correction.id, pos, line.description, line.quantity, line.unitPrice,
      line.unitOfMeasure.code, line.unitOfMeasure.name, line.taxCode, line.taxCategory, line.taxRate,
      line.totalExcludingTax, line.taxAmount, line.totalIncludingTax))
    const taxStmt = database.prepare(`INSERT INTO correction_tax_breakdown
      (correction_id, line_position, tax_code, category, rate, taxable_amount, tax_amount) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    correction.taxBreakdown.forEach((tax, pos) => taxStmt.run(correction.id, pos, tax.taxCode, tax.category, tax.rate, tax.taxableAmount, tax.taxAmount))
  }),
  findCorrection: (organizationId, id) => read("find correction", () => {
    const value = row(database.prepare("SELECT * FROM correction_documents WHERE organization_id = ? AND id = ?").get(organizationId, id))
    if (value === undefined) return undefined
    const documentSource = sourceFrom(value)
    const lines: ReadonlyArray<DraftLine> = database.prepare("SELECT * FROM correction_lines WHERE correction_id = ? ORDER BY line_position").all(id).map((v) => lineFrom(v as Row))
    const taxBreakdown: ReadonlyArray<TaxBreakdown> = database.prepare("SELECT * FROM correction_tax_breakdown WHERE correction_id = ? ORDER BY line_position").all(id).map((item) => {
      const tax = item as Row
      return { taxCode: text(tax, "tax_code"), category: "standard", rate: text(tax, "rate"), taxableAmount: text(tax, "taxable_amount"), taxAmount: text(tax, "tax_amount") }
    })
    return {
      id, organizationId, originalInvoiceId: text(value, "original_invoice_id"), fiscalYear: integer(value, "fiscal_year"), series: text(value, "series"), number: integer(value, "number"),
      ...(documentSource === undefined ? {} : { source: documentSource }),
      issueDate: text(value, "issue_date"), issuedAt: text(value, "issued_at"), reason: text(value, "reason"), currency: text(value, "currency"),
      issuer: partyFrom(value, "issuer_"), customer: buyerFrom(value, "customer_"), lines, taxBreakdown,
      totalExcludingTax: text(value, "total_excluding_tax"), taxTotal: text(value, "tax_total"), totalIncludingTax: text(value, "total_including_tax"),
    }
  }),
  listCorrections: (organizationId, originalInvoiceId, source) => read("list corrections", () => {
    const filter = sourceFilter(source)
    const rows = database.prepare(`SELECT * FROM correction_documents WHERE organization_id = ? AND original_invoice_id = ?${filter.sql}
      ORDER BY issued_at, number, id`).all(organizationId, originalInvoiceId, ...filter.values) as ReadonlyArray<Row>
    return rows.map((value) => {
      const id = text(value, "id")
      const documentSource = sourceFrom(value)
      const lines: ReadonlyArray<DraftLine> = database.prepare("SELECT * FROM correction_lines WHERE correction_id = ? ORDER BY line_position").all(id).map((v) => lineFrom(v as Row))
      const taxBreakdown: ReadonlyArray<TaxBreakdown> = database.prepare("SELECT * FROM correction_tax_breakdown WHERE correction_id = ? ORDER BY line_position").all(id).map((item) => {
        const tax = item as Row
        return { taxCode: text(tax, "tax_code"), category: "standard", rate: text(tax, "rate"), taxableAmount: text(tax, "taxable_amount"), taxAmount: text(tax, "tax_amount") }
      })
      return {
        id, organizationId, originalInvoiceId: text(value, "original_invoice_id"), fiscalYear: integer(value, "fiscal_year"), series: text(value, "series"), number: integer(value, "number"),
        ...(documentSource === undefined ? {} : { source: documentSource }),
        issueDate: text(value, "issue_date"), issuedAt: text(value, "issued_at"), reason: text(value, "reason"), currency: text(value, "currency"),
        issuer: partyFrom(value, "issuer_"), customer: buyerFrom(value, "customer_"), lines, taxBreakdown,
        totalExcludingTax: text(value, "total_excluding_tax"), taxTotal: text(value, "tax_total"), totalIncludingTax: text(value, "total_including_tax"),
      }
    })
  }),
  findIdempotencyRecord: (organizationId, key) => read("find idempotency record", () => {
    const value = row(database.prepare("SELECT * FROM idempotency_records WHERE organization_id=? AND idempotency_key=?")
      .get(organizationId, key))
    return value === undefined ? undefined : {
      organizationId: text(value, "organization_id"), key: text(value, "idempotency_key"),
      operation: text(value, "operation") as IdempotencyRecord["operation"],
      fingerprint: text(value, "fingerprint"), resultKind: text(value, "result_kind") as IdempotencyRecord["resultKind"],
      resultId: text(value, "result_id"), createdAt: text(value, "created_at"),
    }
  }),
  saveIdempotencyRecord: (record) => write("save idempotency record", () => {
    database.prepare(`INSERT INTO idempotency_records
      (organization_id,idempotency_key,operation,fingerprint,result_kind,result_id,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(record.organizationId, record.key, record.operation, record.fingerprint, record.resultKind, record.resultId, record.createdAt)
  }),
})

const paymentsTransactionAdapter = (database: DatabaseSync): PaymentsTransaction => ({
  findInvoiceSnapshot: (organizationId, id) => paymentRead("find issued invoice", () => {
    const value = row(database.prepare("SELECT * FROM issued_invoices WHERE organization_id = ? AND id = ?").get(organizationId, id))
    return value === undefined ? undefined : {
      id: text(value, "id"), organizationId: text(value, "organization_id"), currency: text(value, "currency"),
      dueDate: nullableText(value, "due_date"), totalIncludingTax: text(value, "total_including_tax"),
    }
  }),
  savePayment: (payment) => paymentWrite("save payment", () => {
    const result = database.prepare(`INSERT INTO invoice_payments
      (id, invoice_id, organization_id, amount, currency, payment_date, method, external_reference, note, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(payment.id, payment.invoiceId, payment.organizationId, payment.amount, payment.currency,
        payment.paymentDate, payment.method, payment.externalReference ?? null, payment.note ?? null,
        payment.actorId, payment.createdAt)
    if (result.changes === 0) throw new PaymentsDomainConflict({ code: "payment_not_saved", message: "Payment could not be saved" })
  }),
  listPayments: (organizationId, invoiceId) => paymentRead("list payments", () =>
    database.prepare("SELECT * FROM invoice_payments WHERE organization_id = ? AND invoice_id = ? ORDER BY payment_date, created_at, id")
      .all(organizationId, invoiceId).map((value) => paymentFrom(value as Row))),
})

const openTransaction = (dataDirectory: string): TransactionHandle => {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(databasePath(dataDirectory))
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("PRAGMA busy_timeout = 5000")
    database.exec("BEGIN IMMEDIATE")
    return { database, open: true, closed: false }
  } catch (error) {
    try { database?.close() } catch { /* acquisition failure wins */ }
    throw error
  }
}

const commitAndClose = (handle: TransactionHandle): void => {
  handle.database.exec("COMMIT")
  handle.open = false
  handle.database.close()
  handle.closed = true
}

const releaseTransaction = (handle: TransactionHandle): void => {
  if (handle.open) {
    try { handle.database.exec("ROLLBACK") } catch { /* original failure wins */ }
  }
  if (!handle.closed) {
    try { handle.database.close(); handle.closed = true } catch { /* original failure wins */ }
  }
}

export const createSqliteStore = (dataDirectory: string): TransactionalStore<InvoicingTransaction> => ({
  transaction: (use) => Effect.acquireUseRelease(
    Effect.try({
      try: () => openTransaction(dataDirectory),
      catch: () => persistence("begin transaction"),
    }),
    (handle) => Effect.tap(use(transactionAdapter(handle.database)), () => Effect.try({
      try: () => { commitAndClose(handle) },
      catch: () => persistence("commit transaction"),
    })),
    (handle) => Effect.sync(() => { releaseTransaction(handle) }),
  ),
})

export const createSqlitePaymentsStore = (dataDirectory: string): PaymentsStore<PaymentsTransaction> => ({
  transaction: (use) => Effect.acquireUseRelease(
    Effect.try({
      try: () => openTransaction(dataDirectory),
      catch: () => paymentsPersistence("begin transaction"),
    }),
    (handle) => Effect.tap(use(paymentsTransactionAdapter(handle.database)), () => Effect.try({
      try: () => { commitAndClose(handle) },
      catch: () => paymentsPersistence("commit transaction"),
    })),
    (handle) => Effect.sync(() => { releaseTransaction(handle) }),
  ),
})
