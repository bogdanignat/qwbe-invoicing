import type { DatabaseSync } from "node:sqlite"

import type { VatConfiguration } from "../../cube/invoicing/index.ts"
import type { IssuerTransaction } from "../../cube/invoicing/issuer/index.ts"
import { addressValues, integer, optionalText, read, row, text, write, type Row } from "./sqlite-rows.ts"
import { vatTreatment, vatTreatmentFrom } from "./sqlite-document-lines.ts"
import { brandingFrom, issuerCompanyDetailsFrom } from "./sqlite-document-parties.ts"

export const issuerTransactionAdapter = (database: DatabaseSync): IssuerTransaction => ({
  saveIssuer: (issuer) => write("save issuer", () => {
    database.prepare(`INSERT INTO issuers
      (organization_id, legal_name, tax_identifier, country_code, city, street, county, sector, postal_code,
       legal_form, trade_registry_number, iban, bank_name, social_capital,
       default_currency, default_payment_term_days, branding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (organization_id) DO UPDATE SET legal_name=excluded.legal_name,
       tax_identifier=excluded.tax_identifier, country_code=excluded.country_code, city=excluded.city,
        street=excluded.street, county=excluded.county, sector=excluded.sector, postal_code=excluded.postal_code,
          legal_form=excluded.legal_form, trade_registry_number=excluded.trade_registry_number,
          iban=excluded.iban, bank_name=excluded.bank_name, social_capital=excluded.social_capital,
         default_currency=excluded.default_currency, default_payment_term_days=excluded.default_payment_term_days,
         branding=excluded.branding`)
      .run(issuer.organizationId, issuer.name, issuer.fiscalIdentifier, ...addressValues(issuer.address),
        issuer.legalForm, issuer.tradeRegistryNumber, issuer.iban, issuer.bankName, issuer.socialCapital,
        issuer.defaultCurrency, issuer.defaultPaymentTermDays, issuer.branding === null ? null : JSON.stringify(issuer.branding))
    database.prepare("DELETE FROM issuer_tax_configurations WHERE organization_id = ?").run(issuer.organizationId)
    const statement = database.prepare(`INSERT INTO issuer_tax_configurations
      (organization_id, code, category, rate, vat_exemption_reason, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    issuer.vatConfigurations.forEach((tax) => {
      vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
      statement.run(issuer.organizationId, tax.code, tax.vatCategoryCode, tax.rate, tax.vatExemptionReason,
        tax.effectiveFrom, tax.effectiveTo ?? null)
    })
  }),
  findIssuer: (organizationId) => read("find issuer", () => {
    const value = row(database.prepare("SELECT * FROM issuers WHERE organization_id = ?").get(organizationId))
    if (value === undefined) return undefined
    const vatConfigurations: ReadonlyArray<VatConfiguration> = database.prepare(
      "SELECT * FROM issuer_tax_configurations WHERE organization_id = ? ORDER BY code, effective_from",
    ).all(organizationId).map((item) => {
      const tax = item as Row
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
