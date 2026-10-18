import { HttpApiEndpoint } from "@effect/platform"
import { Schema } from "effect"

import * as C from "./schema-customers-catalog.ts"
import * as I from "./schema-issuer.ts"
import { PageQuery, UnitOfMeasure } from "./schema-primitives.ts"
import { body, conflict, id, invoicingBase, notFound, validation } from "./http-api-shared.ts"
import { Deleted } from "./schema-errors-session.ts"

export const masterDataEndpoints = {
  getIssuer: invoicingBase(notFound(HttpApiEndpoint.get("getIssuer", "/issuer").addSuccess(I.Issuer))),
  configureIssuer: invoicingBase(validation(body(HttpApiEndpoint.put("configureIssuer", "/issuer").setPayload(I.IssuerInput).addSuccess(I.Issuer)))),
  listDocumentSeries: invoicingBase(HttpApiEndpoint.get("listDocumentSeries", "/document-series").addSuccess(Schema.Array(I.DocumentSeries))),
  addDocumentSeries: invoicingBase(conflict(validation(body(HttpApiEndpoint.post("addDocumentSeries", "/document-series").setPayload(I.DocumentSeriesInput).addSuccess(I.DocumentSeries))))),
  listUnitOfMeasures: invoicingBase(HttpApiEndpoint.get("listUnitOfMeasures", "/unit-of-measures").addSuccess(Schema.Array(UnitOfMeasure))),
  listVatRegimes: invoicingBase(validation(HttpApiEndpoint.get("listVatRegimes", "/vat-regimes").addSuccess(I.VatCatalogue))),
  listCustomers: invoicingBase(validation(HttpApiEndpoint.get("listCustomers", "/customers").setUrlParams(PageQuery).addSuccess(C.CustomerPage))),
  getCustomer: invoicingBase(notFound(HttpApiEndpoint.get("getCustomer")`/customers/${id}`.addSuccess(C.Customer))),
  createCustomer: invoicingBase(validation(body(HttpApiEndpoint.post("createCustomer", "/customers").setPayload(C.CustomerInput).addSuccess(C.Customer)))),
  updateCustomer: invoicingBase(notFound(validation(body(HttpApiEndpoint.put("updateCustomer")`/customers/${id}`.setPayload(C.CustomerInput).addSuccess(C.Customer))))),
  deleteCustomer: invoicingBase(conflict(notFound(body(HttpApiEndpoint.del("deleteCustomer")`/customers/${id}`.addSuccess(Deleted))))),
  listProductPresets: invoicingBase(validation(HttpApiEndpoint.get("listProductPresets", "/product-presets").setUrlParams(PageQuery).addSuccess(C.ProductPresetPage))),
  createProductPreset: invoicingBase(validation(body(HttpApiEndpoint.post("createProductPreset", "/product-presets").setPayload(C.ProductPresetInput).addSuccess(C.ProductPreset)))),
  updateProductPreset: invoicingBase(notFound(validation(body(HttpApiEndpoint.put("updateProductPreset")`/product-presets/${id}`
    .setPayload(C.ProductPresetInput).addSuccess(C.ProductPreset))))),
  deleteProductPreset: invoicingBase(notFound(body(HttpApiEndpoint.del("deleteProductPreset")`/product-presets/${id}`.addSuccess(Deleted)))),
} as const
