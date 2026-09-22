import { HttpApiEndpoint } from "@effect/platform"
import { Schema } from "effect"

import {
  conflict, draftId, id, idempotentBody, invoiceId, invoicingBase, notFound, paymentId, validation,
} from "./http-api-shared.ts"
import * as F from "./schema-issuance.ts"
import * as P from "./schema-payments.ts"
import { EFacturaXml } from "./schema-documents.ts"
import { ListQuery, SourceFilter } from "./schema-primitives.ts"
import { InvoiceRegisterPage } from "./schema-invoice-register.ts"

export const fiscalEndpoints = {
  listInvoiceRegister: invoicingBase(validation(HttpApiEndpoint.get("listInvoiceRegister", "/invoice-register").setUrlParams(ListQuery).addSuccess(InvoiceRegisterPage))),
  listPayments: invoicingBase(notFound(HttpApiEndpoint.get("listPayments")`/invoices/${invoiceId}/payments`.addSuccess(P.PaymentSummary))),
  recordPayment: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("recordPayment")`/invoices/${invoiceId}/payments`.setPayload(P.PaymentInput).addSuccess(P.RecordPaymentResult)))))),
  reversePayment: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("reversePayment")`/invoices/${invoiceId}/payments/${paymentId}/reversal`.setPayload(P.ReversalInput).addSuccess(P.RecordPaymentResult)))))),
  createCorrection: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("createCorrection")`/invoices/${invoiceId}/corrections`.setPayload(F.CorrectionInput).addSuccess(F.Correction)))))),
  listCorrections: invoicingBase(validation(HttpApiEndpoint.get("listCorrections")`/invoices/${invoiceId}/corrections`.setUrlParams(SourceFilter).addSuccess(Schema.Array(F.Correction)))),
  getCorrection: invoicingBase(notFound(HttpApiEndpoint.get("getCorrection")`/corrections/${id}`.addSuccess(F.Correction))),
  downloadCorrectionEFactura: invoicingBase(validation(notFound(HttpApiEndpoint.get("downloadCorrectionEFactura")`/corrections/${id}/efactura.xml`.addSuccess(EFacturaXml)))),
  listIssuedInvoices: invoicingBase(validation(HttpApiEndpoint.get("listIssuedInvoices", "/invoices").setUrlParams(ListQuery).addSuccess(F.IssuedInvoicePage))),
  issueInvoice: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("issueInvoice", "/invoices").setPayload(F.AuthoringDocumentInput).addSuccess(F.IssuedInvoice)))))),
  getIssuedInvoice: invoicingBase(notFound(HttpApiEndpoint.get("getIssuedInvoice")`/invoices/${id}`.addSuccess(F.IssuedInvoice))),
  downloadInvoiceEFactura: invoicingBase(validation(notFound(HttpApiEndpoint.get("downloadInvoiceEFactura")`/invoices/${id}/efactura.xml`.addSuccess(EFacturaXml)))),
  issueDraftProforma: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("issueDraftProforma")`/drafts/${draftId}/proformas`.setPayload(F.IssueProformaInput).addSuccess(F.Proforma)))))),
  listProformas: invoicingBase(validation(HttpApiEndpoint.get("listProformas", "/proformas").setUrlParams(ListQuery).addSuccess(F.ProformaPage))),
  issueProforma: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("issueProforma", "/proformas").setPayload(F.AuthoringProformaInput).addSuccess(F.Proforma)))))),
  getProforma: invoicingBase(notFound(HttpApiEndpoint.get("getProforma")`/proformas/${id}`.addSuccess(F.Proforma))),
  issueInvoiceFromProforma: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("issueInvoiceFromProforma")`/proformas/${id}/invoice`.setPayload(F.ConvertProformaInput).addSuccess(F.IssuedInvoice)))))),
  createDraftInvoiceFromProforma: invoicingBase(conflict(notFound(validation(idempotentBody(HttpApiEndpoint.post("createDraftInvoiceFromProforma")`/proformas/${id}/draft-invoice`.setPayload(F.ConvertProformaInput).addSuccess(F.DraftInvoice)))))),
} as const
