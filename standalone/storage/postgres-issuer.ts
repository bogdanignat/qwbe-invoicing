import type { VatConfiguration } from "../../cube/invoicing/index.ts"
import type { IssuerTransaction } from "../../cube/invoicing/issuer/index.ts"
import { read, write } from "./postgres-errors.ts"
import { addressColumns, addressValues, firstRow, integer, optionalText, text } from "./postgres-rows.ts"
import { assignExcluded, insertStatement, pairs } from "./postgres-sql.ts"
import { vatTreatment, vatTreatmentFrom } from "./postgres-document-lines.ts"
import { brandingFrom, issuerColumns, issuerCompanyDetailsFrom } from "./postgres-document-parties.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

const issuerTableColumns = [
  "organization_id", "legal_name", "tax_identifier", ...addressColumns(),
  ...issuerColumns(""), "default_currency", "default_payment_term_days", "branding",
]

const issuerUpdatedColumns = issuerTableColumns.filter((column) => column !== "organization_id")

export const issuerTransactionAdapter = (client: TransactionClient): IssuerTransaction => ({
  saveIssuer: (issuer) => write("save issuer", async () => {
    const statement = insertStatement("issuers", pairs(issuerTableColumns, [
      issuer.organizationId, issuer.name, issuer.fiscalIdentifier, ...addressValues(issuer.address),
      issuer.legalForm, issuer.tradeRegistryNumber, issuer.iban, issuer.bankName, issuer.socialCapital,
      issuer.defaultCurrency, issuer.defaultPaymentTermDays,
      issuer.branding === null ? null : JSON.stringify(issuer.branding),
    ]))
    await client.query(
      `${statement.sql} ON CONFLICT (organization_id) DO UPDATE SET ${assignExcluded(issuerUpdatedColumns)}`,
      statement.values,
    )
    await client.query("DELETE FROM issuer_tax_configurations WHERE organization_id = $1", [issuer.organizationId])
    for (const tax of issuer.vatConfigurations) {
      vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
      await client.query(
        `INSERT INTO issuer_tax_configurations
          (organization_id, code, category, rate, vat_exemption_reason, effective_from, effective_to)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [issuer.organizationId, tax.code, tax.vatCategoryCode, tax.rate, tax.vatExemptionReason,
          tax.effectiveFrom, tax.effectiveTo ?? null],
      )
    }
  }),
  findIssuer: (organizationId) => read("find issuer", async () => {
    const { rows } = await client.query("SELECT * FROM issuers WHERE organization_id = $1", [organizationId])
    const value = firstRow(rows)
    if (value === undefined) return undefined
    const configurations = await client.query(
      "SELECT * FROM issuer_tax_configurations WHERE organization_id = $1 ORDER BY code, effective_from",
      [organizationId],
    )
    const vatConfigurations: ReadonlyArray<VatConfiguration> = configurations.rows.map((tax) => {
      const effectiveTo = optionalText(tax, "effective_to")
      const treatment = vatTreatmentFrom(tax, "code", "rate", "category")
      return {
        code: treatment.code, rate: treatment.rate, vatCategoryCode: treatment.vatCategoryCode,
        vatExemptionReason: treatment.vatExemptionReason, effectiveFrom: text(tax, "effective_from"),
        ...(effectiveTo === undefined ? {} : { effectiveTo }),
      }
    })
    return {
      ...issuerCompanyDetailsFrom(value, "", false), organizationId, defaultCurrency: text(value, "default_currency"),
      defaultPaymentTermDays: integer(value, "default_payment_term_days"), vatConfigurations,
      branding: brandingFrom(value, "branding"),
    }
  }),
})
