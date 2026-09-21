import { Schema } from "effect"

import type { ConfigureIssuerInput } from "../../cube/invoicing/index.ts"
import { Address, bodyObject, FiscalIdentifierInput, nullableString, optional, optionalString, Party } from "./schema-primitives.ts"

export const IssuerCompany = Schema.Struct({
  ...Party.fields, legalForm: Schema.Literal("srl", "pfa"), tradeRegistryNumber: Schema.String,
  iban: Schema.String, bankName: Schema.String, socialCapital: Schema.String,
})
export const IssuerCompanySnapshot = Schema.Struct({ ...IssuerCompany.fields, vatRegistered: Schema.Boolean })
const BrandingTextInput = Schema.NullOr(Schema.String)
const IssuerBrandingInput = Schema.NullOr(Schema.Struct({
  text: BrandingTextInput, image: Schema.NullOr(Schema.Struct({ dataBase64: Schema.String })),
}))
const IssuerBrandingImage = Schema.Struct({ pngBase64: Schema.String, width: Schema.Int, height: Schema.Int })
const IssuerBranding = Schema.NullOr(Schema.Struct({
  text: Schema.NullOr(Schema.String), image: Schema.NullOr(IssuerBrandingImage),
}))
export const IssuerParty = Schema.Struct({ ...IssuerCompanySnapshot.fields, branding: IssuerBranding })
const VatTreatmentFields = { vatCategoryCode: Schema.Literal("S", "O"), vatExemptionReason: nullableString }
export const VatConfiguration = Schema.Struct({
  ...VatTreatmentFields, code: Schema.String, rate: Schema.String, effectiveFrom: Schema.String, effectiveTo: optionalString,
})
const VatChangeFields = Schema.Struct({
  registered: Schema.Boolean, effectiveFrom: Schema.String, nonVatBasis: optional(Schema.Unknown),
})
const explicitVatBasis = <A extends Schema.Schema.Type<typeof VatChangeFields>, I, R>(schema: Schema.Schema<A, I, R>) =>
  schema.pipe(Schema.filter((input): input is A & ConfigureIssuerInput["vatChange"] =>
    input.registered ? !Object.hasOwn(input, "nonVatBasis") : input.nonVatBasis === "article_310", {
    message: () => "nonVatBasis must be article_310 for a non-VAT issuer and absent for a VAT-registered issuer",
  }))
export const VatChange = VatChangeFields.annotations(bodyObject).pipe(explicitVatBasis)
export const VatRegistration = Schema.Struct({ ...VatChangeFields.fields, effectiveTo: optionalString }).pipe(explicitVatBasis)
export const VatRate = Schema.Struct({
  ...VatTreatmentFields, code: Schema.String, rate: Schema.String,
  kind: Schema.Literal("standard", "reduced", "non_vat"), label: Schema.String,
  effectiveFrom: Schema.String, effectiveTo: optionalString,
})
export const VatCatalogue = Schema.Struct({ rates: Schema.Array(VatRate) })
export const IssuerInput = Schema.Struct({
  name: Schema.String, fiscalIdentifier: FiscalIdentifierInput, address: Address,
  legalForm: Schema.Literal("srl", "pfa"), tradeRegistryNumber: Schema.String, iban: Schema.String,
  bankName: Schema.String, socialCapital: Schema.String, defaultCurrency: Schema.String,
  defaultPaymentTermDays: Schema.Int, vatChange: VatChange, branding: IssuerBrandingInput,
}).annotations(bodyObject)
export const Issuer = Schema.Struct({
  name: Schema.String, fiscalIdentifier: Schema.String, address: Address,
  legalForm: Schema.Literal("srl", "pfa"), tradeRegistryNumber: Schema.String, iban: Schema.String,
  bankName: Schema.String, socialCapital: Schema.String, organizationId: Schema.String,
  defaultCurrency: Schema.String, defaultPaymentTermDays: Schema.Int,
  vatConfigurations: Schema.Array(VatConfiguration), currentVat: Schema.NullOr(VatRegistration), branding: IssuerBranding,
})
export const DocumentSeriesInput = Schema.Struct({
  documentType: Schema.Literal("invoice", "proforma"), series: Schema.String,
}).annotations(bodyObject)
export const DocumentSeries = Schema.Struct({
  organizationId: Schema.String, documentType: Schema.Literal("invoice", "proforma"), series: Schema.String,
})
