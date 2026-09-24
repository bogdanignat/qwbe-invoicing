import type { Effect } from "effect"
import type { ApiFailure } from "./api-errors.ts"
import type {
  Address, BuyerSnapshot, CorrectionDocument, DocumentSource, DocumentType, IssuedInvoice,
  LegalForm, PaymentSummary, ProductPreset, UnitOfMeasure, VatChange,
} from "./models.ts"

export interface InvoiceBundle {
  readonly invoice: IssuedInvoice
  readonly paymentSummary: PaymentSummary
  readonly corrections: ReadonlyArray<CorrectionDocument>
}

export type CreateDocumentSeriesInput = {
  readonly documentType: DocumentType
  readonly series: string
}

export type CustomerInput = BuyerSnapshot & { readonly defaultPaymentTermDays?: number }

export type ProductPresetInput = Pick<
  ProductPreset,
  "description" | "unitPrice" | "unitOfMeasure" | "preferredVatRateCode"
>

export interface IssuerInput {
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: Address
  readonly legalForm: LegalForm
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly vatChange: VatChange
  readonly branding: {
    readonly text: string | null
    readonly image: { readonly dataBase64: string } | null
  } | null
}

export type BuyerSource =
  | { readonly customerId: string; readonly customer?: never }
  | { readonly customer: BuyerSnapshot; readonly customerId?: never }

export type CreateDraftInput = BuyerSource & {
  readonly source?: DocumentSource
  readonly series: string
  readonly issueDate: string
  readonly currency?: "RON"
  readonly dueDate?: string | null
  readonly notes?: string | null
  readonly lines?: ReadonlyArray<DraftLineInput>
}

export type UpdateDraftInput = BuyerSource & {
  readonly source?: DocumentSource | null
  readonly issueDate: string
  readonly dueDate?: string | null
  readonly notes?: string | null
}

export interface DraftLineInput {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
}

export type AuthoringDocumentInput = CreateDraftInput & {
  readonly currency: "RON"
  readonly lines: ReadonlyArray<DraftLineInput>
}

export type AuthoringProformaInput = BuyerSource & {
  readonly proformaSeries: string
  readonly issueDate: string
  readonly dueDate?: string | null
  readonly currency: "RON"
  readonly notes?: string | null
  readonly source?: DocumentSource
  readonly lines: ReadonlyArray<DraftLineInput>
}

export type InvoiceBundleEffect = Effect.Effect<InvoiceBundle, ApiFailure>
