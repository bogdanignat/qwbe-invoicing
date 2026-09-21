import { array, object, optionalText, text, type Decoder } from "./model-decoder.ts"
import type { DocumentSeries, DocumentType, ProductPreset, UnitOfMeasure } from "./catalog-models.ts"

export const documentSeriesFor = (documentType: DocumentType) =>
  (series: ReadonlyArray<DocumentSeries>): ReadonlyArray<DocumentSeries> =>
    series.filter((item) => item.documentType === documentType)

export const invoiceDocumentSeries = (
  series: ReadonlyArray<DocumentSeries>,
): ReadonlyArray<DocumentSeries> => documentSeriesFor("invoice")(series)

export const proformaDocumentSeries = (
  series: ReadonlyArray<DocumentSeries>,
): ReadonlyArray<DocumentSeries> => documentSeriesFor("proforma")(series)

export const decodeUnitOfMeasure: Decoder<UnitOfMeasure> = (input) => {
  const value = object(input)
  return { code: text(value.code, "code"), name: text(value.name, "name") }
}

export const decodeProductPreset: Decoder<ProductPreset> = (input) => {
  const value = object(input)
  const preferredVatRateCode = optionalText(value.preferredVatRateCode, "preferredVatRateCode")
  return {
    id: text(value.id, "id"),
    organizationId: text(value.organizationId, "organizationId"),
    description: text(value.description, "description"),
    unitPrice: text(value.unitPrice, "unitPrice"),
    unitOfMeasure: decodeUnitOfMeasure(value.unitOfMeasure),
    ...(preferredVatRateCode === undefined ? {} : { preferredVatRateCode }),
  }
}

export const decodeDocumentSeries: Decoder<DocumentSeries> = (input) => {
  const value = object(input)
  const documentType = text(value.documentType, "documentType")
  if (documentType !== "invoice" && documentType !== "proforma") throw new Error("invalid documentType")
  return {
    organizationId: text(value.organizationId, "organizationId"),
    documentType,
    series: text(value.series, "series"),
  }
}

export const decodeProductPresets: Decoder<ReadonlyArray<ProductPreset>> = (input) =>
  array(input, decodeProductPreset, "productPresets")
export const decodeUnitOfMeasures: Decoder<ReadonlyArray<UnitOfMeasure>> = (input) =>
  array(input, decodeUnitOfMeasure, "unitOfMeasures")
export const decodeDocumentSeriesList: Decoder<ReadonlyArray<DocumentSeries>> = (input) =>
  array(input, decodeDocumentSeries, "documentSeries")
