/**
 * Received UBL documents for the tests of `received-ubl` and `received`, with the usual `cac`/`cbc`
 * prefixes. The default is a consistent RON invoice: two lines (90.00 after a
 * 10.00 line allowance, and 110.00), a 20.00 document allowance, 21% VAT on
 * 180.00. Each part can be replaced to build the other cases.
 */
export const UBL = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  creditNote: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
} as const

export const BUYER_CIF = "12345678"

const party = (name: string, taxScheme: string, legal: string): string => `<cac:Party>
      <cac:PartyName><cbc:Name>${name} comercial</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Str. Lunga nr. 2</cbc:StreetName>
        <cbc:CityName>Sector 1</cbc:CityName>
        <cbc:CountrySubentity>RO-B</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${taxScheme}
      <cac:PartyLegalEntity><cbc:RegistrationName>${name}</cbc:RegistrationName>${legal}</cac:PartyLegalEntity>
    </cac:Party>`

export const vatScheme = (id: string, scheme = "VAT"): string =>
  `<cac:PartyTaxScheme><cbc:CompanyID>${id}</cbc:CompanyID><cac:TaxScheme><cbc:ID>${scheme}</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`

export const LINES = `<cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="H87">2.5000</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">90.00</cbc:LineExtensionAmount>
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>
      <cbc:AllowanceChargeReason>Discount linie</cbc:AllowanceChargeReason>
      <cbc:Amount currencyID="RON">10.00</cbc:Amount>
    </cac:AllowanceCharge>
    <cac:Item>
      <cbc:Description>Hartie A4</cbc:Description>
      <cbc:Name>Hartie</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>HA4</cbc:ID></cac:SellersItemIdentification>
      <cac:StandardItemIdentification><cbc:ID schemeID="0160">5941234567890</cbc:ID></cac:StandardItemIdentification>
      <cac:CommodityClassification><cbc:ItemClassificationCode listID="STI">30197630-1</cbc:ItemClassificationCode></cac:CommodityClassification>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">40.000</cbc:PriceAmount><cbc:BaseQuantity unitCode="H87">1</cbc:BaseQuantity></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="HUR">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">110.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Servicii</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">110.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`

export const TAX_TOTALS = `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">37.80</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">180.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">37.80</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`

export const totals = (currency = "RON", inclusive = "217.80"): string => `<cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">200.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">180.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${inclusive}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${currency}">20.00</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${currency}">${inclusive}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`

export interface Sample {
  readonly root?: "Invoice" | "CreditNote"
  readonly header?: string
  readonly currency?: string
  readonly buyer?: string
  readonly allowances?: string
  readonly taxTotals?: string
  readonly totals?: string
  readonly lines?: string
}

const DEFAULT_ALLOWANCE = `<cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Discount comercial</cbc:AllowanceChargeReason>
    <cbc:MultiplierFactorNumeric>10</cbc:MultiplierFactorNumeric>
    <cbc:Amount currencyID="RON">20.00</cbc:Amount>
    <cbc:BaseAmount currencyID="RON">200.00</cbc:BaseAmount>
    <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
  </cac:AllowanceCharge>`

export const sampleXml = (sample: Sample = {}): string => {
  const root = sample.root ?? "Invoice"
  const namespace = root === "Invoice" ? UBL.invoice : UBL.creditNote
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${namespace}" xmlns:cac="${UBL.cac}" xmlns:cbc="${UBL.cbc}">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>FX 100</cbc:ID>
  <cbc:IssueDate>2026-10-01</cbc:IssueDate>
  ${sample.header ?? `<cbc:DueDate>2026-10-31</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>Prima nota</cbc:Note>`}
  <cbc:DocumentCurrencyCode>${sample.currency ?? "RON"}</cbc:DocumentCurrencyCode>
  <cac:OrderReference><cbc:ID>CMD-7</cbc:ID></cac:OrderReference>
  <cac:ContractDocumentReference><cbc:ID>CTR-1</cbc:ID></cac:ContractDocumentReference>
  <cac:AccountingSupplierParty>
    ${party("FURNIZOR SRL", vatScheme("RO 11111111"), "<cbc:CompanyID>J40/1/2020</cbc:CompanyID>")}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${sample.buyer ?? party("CUMPARATOR SRL", vatScheme(`RO${BUYER_CIF}`), "<cbc:CompanyID>J12/3/2021</cbc:CompanyID>")}
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>RO49AAAA1B31007593840000</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  ${sample.allowances ?? DEFAULT_ALLOWANCE}
  ${sample.taxTotals ?? TAX_TOTALS}
  ${sample.totals ?? totals()}
  ${sample.lines ?? LINES}
</${root}>`
}

/** An invoice of about `bytes` UTF-8 bytes, made of copies of the first sample line with their own IDs. */
export const largeInvoiceXml = (bytes: number): string => {
  const line = /<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/u.exec(LINES)?.[0] ?? ""
  const count = Math.floor(bytes / line.length)
  return sampleXml({ lines: Array.from({ length: count }, (_, index) => line.replace("<cbc:ID>1</cbc:ID>", `<cbc:ID>${String(index + 1)}</cbc:ID>`)).join("\n  ") })
}
