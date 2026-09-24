import type { BuyerSnapshot, Customer, DraftInvoice, Issuer, ProductPreset, UnitOfMeasure, VatCatalogue, VatRate } from "../lib/draft-models.ts"
import type { DraftDeletionState } from "../lib/invoice-authoring-workflow.ts"
import type { RecoveryRecord } from "../lib/operation-recovery-types.ts"
import type { RecoveryNoticeModel } from "../lib/operation-recovery-view.ts"
import type {
  BuyerMode, EditableInvoiceLine, InvoiceAuthoringForm, PartyType,
} from "../lib/invoice-authoring-model.ts"

/** The saved customer a draft was written for, even when the paged registry has not reached it yet. */
export interface SavedBuyer {
  readonly customerId: string
  readonly customer: BuyerSnapshot
}

export interface BackgroundError {
  readonly error: Error
  readonly retry: (() => void) | undefined
}

export interface InvoiceAuthoringSessionInput {
  readonly initialDraft: DraftInvoice | undefined
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly customers: ReadonlyArray<Customer>
  readonly customersHasMore: boolean
  readonly customersLoadingMore: boolean
  readonly customersLoadMore: () => void
  readonly invoiceSeries: ReadonlyArray<string>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly productPresets: ReadonlyArray<ProductPreset>
  readonly presetsHasMore: boolean
  readonly presetsLoadingMore: boolean
  readonly presetsLoadMore: () => void
  readonly backgroundErrors: ReadonlyArray<BackgroundError>
}

export interface InvoiceAuthoringSession {
  readonly document: {
    readonly draft: DraftInvoice | undefined
    readonly issuer: Issuer & { readonly vatRegistered: boolean }
    readonly customers: ReadonlyArray<Customer>
    readonly customersHasMore: boolean
    readonly customersLoadingMore: boolean
    readonly customersLoadMore: () => void
    readonly invoiceSeries: ReadonlyArray<string>
    readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
    readonly form: InvoiceAuthoringForm
    readonly lines: ReadonlyArray<EditableInvoiceLine>
    readonly savedBuyer: SavedBuyer | undefined
    readonly buyerSectorRequired: boolean
    readonly productPresets: ReadonlyArray<ProductPreset>
    readonly presetsHasMore: boolean
    readonly presetsLoadingMore: boolean
    readonly presetsLoadMore: () => void
    readonly vatRates: ReadonlyArray<VatRate>
  }
  readonly feedback: {
    readonly backgroundErrors: ReadonlyArray<BackgroundError>
    readonly mutationError: unknown
    readonly resumableSave: boolean
    readonly unconfirmedMessage: string | undefined
    readonly issueUnconfirmedMessage: string | undefined
    readonly issuerWarning: string | undefined
    readonly staleTaxWarning: string | null
    readonly notesIssue: string | null
    readonly notesMaxLength: number
    readonly dueDateIssue: string | null
    readonly notice: string | null
    /** An unresolved write from this tab, described well enough to be recognised in the registry. */
    readonly recoveryNotice: RecoveryNoticeModel | undefined
  }
  readonly status: {
    readonly pending: boolean
    readonly savePending: boolean
    readonly invoicePending: boolean
    readonly canIssueInvoice: boolean
    readonly dueDateRequired: boolean
    /** Nothing new may be written while an earlier operation is unresolved or the journal cannot be read. */
    readonly recoveryBlocked: boolean
    readonly recoveryPending: boolean
  }
  readonly draftDeletion: DraftDeletionState
  readonly derivedNotice: string
  readonly actions: {
    readonly changeForm: (patch: Partial<InvoiceAuthoringForm>) => void
    readonly chooseBuyerMode: (buyerMode: BuyerMode) => void
    readonly chooseCustomer: (customerId: string) => void
    readonly chooseIssueDate: (issueDate: string) => void
    readonly chooseDueDate: (dueDate: string) => void
    readonly choosePartyType: (partyType: PartyType) => void
    readonly chooseCounty: (county: string) => void
    readonly changeFiscalIdentifier: (value: string) => void
    readonly chooseSector: (sector: string) => void
    readonly addLine: () => void
    readonly changeLine: (key: string, patch: Partial<EditableInvoiceLine>) => void
    readonly choosePreset: (lineKey: string, presetId: string) => void
    readonly deleteLine: (line: EditableInvoiceLine) => void
    readonly save: () => void
    readonly issueInvoice: () => void
    readonly deleteDraft: () => void
    readonly replayRecovery: (record: RecoveryRecord) => void
    readonly dismissRecovery: () => void
  }
}
