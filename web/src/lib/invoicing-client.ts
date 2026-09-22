import { documentsClient } from "./documents-client.ts"
import { draftsClient } from "./drafts-client.ts"
import { registryClient } from "./registry-client.ts"
import { settingsClient } from "./settings-client.ts"

export type {
  AuthoringDocumentInput, AuthoringProformaInput, CreateDocumentSeriesInput,
  CreateDraftInput, CustomerInput, DraftLineInput, InvoiceBundle, IssuerInput,
  ProductPresetInput, UpdateDraftInput,
} from "./invoicing-client-types.ts"
export type {
  Customer, DocumentSeries, DraftInvoice, IssuedInvoice,
  Issuer, PageRequest, ProductPreset, Proforma, ProformaSummary, VatCatalogue, VatRate,
} from "./models.ts"
export type { InvoiceRegisterRow } from "./invoice-register.ts"

export const invoicingClient = {
  listCustomers: registryClient.listCustomers,
  createCustomer: registryClient.createCustomer,
  updateCustomer: registryClient.updateCustomer,
  deleteCustomer: registryClient.deleteCustomer,
  listProductPresets: registryClient.listProductPresets,
  listUnitOfMeasures: registryClient.listUnitOfMeasures,
  createProductPreset: registryClient.createProductPreset,
  updateProductPreset: registryClient.updateProductPreset,
  deleteProductPreset: registryClient.deleteProductPreset,
  listInvoiceRegister: documentsClient.listInvoiceRegister,
  getIssuer: settingsClient.getIssuer,
  saveIssuer: settingsClient.saveIssuer,
  getVatCatalogue: settingsClient.getVatCatalogue,
  listDocumentSeries: settingsClient.listDocumentSeries,
  createDocumentSeries: settingsClient.createDocumentSeries,
  createDraft: draftsClient.createDraft,
  listDrafts: draftsClient.listDrafts,
  getDraft: draftsClient.getDraft,
  updateDraft: draftsClient.updateDraft,
  deleteDraft: draftsClient.deleteDraft,
  addDraftLine: draftsClient.addDraftLine,
  updateDraftLine: draftsClient.updateDraftLine,
  deleteDraftLine: draftsClient.deleteDraftLine,
  issueDraft: draftsClient.issueDraft,
  issueInvoice: documentsClient.issueInvoice,
  issueProforma: documentsClient.issueProforma,
  listProformas: documentsClient.listProformas,
  getProforma: documentsClient.getProforma,
  issueInvoiceFromProforma: documentsClient.issueInvoiceFromProforma,
  createDraftFromProforma: documentsClient.createDraftFromProforma,
  getInvoiceBundle: documentsClient.getInvoiceBundle,
  downloadInvoicePdf: documentsClient.downloadInvoicePdf,
  downloadProformaPdf: documentsClient.downloadProformaPdf,
  downloadInvoiceEFactura: documentsClient.downloadInvoiceEFactura,
  recordPayment: documentsClient.recordPayment,
  reversePayment: documentsClient.reversePayment,
  createCorrection: documentsClient.createCorrection,
} as const
