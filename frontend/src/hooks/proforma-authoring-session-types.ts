import type { BackgroundError } from "./invoice-authoring-session-types.ts"
import type {
  Customer, Issuer, ProductPreset, UnitOfMeasure, VatCatalogue, VatRate,
} from "../lib/draft-models.ts"
import type {
  BuyerMode, EditableInvoiceLine, InvoiceAuthoringForm, PartyType,
} from "../lib/invoice-authoring-model.ts"
import type { RecoveryRecord } from "../lib/operation-recovery-types.ts"
import type { RecoveryNoticeModel } from "../lib/operation-recovery-view.ts"

/**
 * One proforma authoring session, as the components underneath see it.
 *
 * It is the invoice session minus everything a proforma does not have: there is
 * no stored draft to reconcile, no line-by-line save, no issuance step and no
 * deletion — a proforma is authored whole in one request and is immutable from
 * the moment it answers. What stays identical is the editing surface, which is
 * why the form, the line and the editor actions are the shared ones.
 */
export interface ProformaAuthoringSessionInput {
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly customers: ReadonlyArray<Customer>
  readonly customersHasMore: boolean
  readonly customersLoadingMore: boolean
  readonly customersLoadMore: () => void
  readonly proformaSeries: ReadonlyArray<string>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly productPresets: ReadonlyArray<ProductPreset>
  readonly presetsHasMore: boolean
  readonly presetsLoadingMore: boolean
  readonly presetsLoadMore: () => void
  readonly backgroundErrors: ReadonlyArray<BackgroundError>
}

export interface ProformaAuthoringSession {
  readonly document: {
    readonly issuer: Issuer & { readonly vatRegistered: boolean }
    readonly customers: ReadonlyArray<Customer>
    readonly customersHasMore: boolean
    readonly customersLoadingMore: boolean
    readonly customersLoadMore: () => void
    readonly proformaSeries: ReadonlyArray<string>
    readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
    readonly form: InvoiceAuthoringForm
    readonly lines: ReadonlyArray<EditableInvoiceLine>
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
    readonly unconfirmedMessage: string | undefined
    readonly issuerWarning: string | undefined
    readonly notesIssue: string | null
    readonly notesMaxLength: number
    /** Set when a positive proforma is left without a due date: it limits what it can become later. */
    readonly dueDateNote: string | null
    /** An unresolved or unfollowed write from this tab, described well enough to be recognised in the registry. */
    readonly recoveryNotice: RecoveryNoticeModel | undefined
  }
  readonly status: {
    readonly pending: boolean
    readonly canSave: boolean
    /** The catalogue holds no proforma series: a setup note next to a closed save, not a failure. */
    readonly seriesMissing: boolean
    readonly recoveryBlocked: boolean
    readonly recoveryPending: boolean
  }
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
    readonly replayRecovery: (record: RecoveryRecord) => void
    readonly dismissRecovery: () => void
  }
}
