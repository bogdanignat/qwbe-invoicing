import type { EditableInvoiceLine, InvoiceAuthoringForm } from "../lib/invoice-authoring-state.ts"
import type { Customer, Issuer, UnitOfMeasure, VatCatalogue, VatRate } from "../lib/models.ts"
import type { useInvoiceAuthoringCustomers } from "./invoice-authoring-customers-hooks.ts"
import type { useInvoiceAuthoringPresets } from "./invoice-authoring-presets-hooks.ts"

export interface ProformaAuthoringSessionInput {
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly customers: ReadonlyArray<Customer>
  readonly proformaSeries: ReadonlyArray<string>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly backgroundErrors: ReadonlyArray<Error>
}

export interface ProformaAuthoringSessionViewModel {
  readonly document: {
    readonly issuer: Issuer & { readonly vatRegistered: boolean }
    readonly customers: ReadonlyArray<Customer>
    readonly proformaSeries: ReadonlyArray<string>
    readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
    readonly form: InvoiceAuthoringForm
    readonly lines: ReadonlyArray<EditableInvoiceLine>
    readonly buyerSectorRequired: boolean
    readonly productPresets: ReturnType<typeof useInvoiceAuthoringPresets>["presets"]
    readonly vatRates: ReadonlyArray<VatRate>
  }
  readonly feedback: {
    readonly backgroundErrors: ReadonlyArray<Error>
    readonly mutationError: Error | null
    readonly issuerWarning: string | undefined
    readonly notesIssue: string | null
    readonly notesMaxLength: number
  }
  readonly status: {
    readonly pending: boolean
    readonly canSave: boolean
    readonly seriesMissing: boolean
  }
  readonly actions: {
    readonly changeForm: (patch: Partial<InvoiceAuthoringForm>) => void
    readonly chooseBuyerMode: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseBuyerMode"]
    readonly chooseCustomer: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseCustomer"]
    readonly chooseIssueDate: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseIssueDate"]
    readonly chooseDueDate: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseDueDate"]
    readonly choosePartyType: (partyType: InvoiceAuthoringForm["partyType"]) => void
    readonly chooseCounty: (county: string) => void
    readonly changeFiscalIdentifier: (value: string) => void
    readonly chooseSector: (sector: string) => void
    readonly addLine: () => void
    readonly changeLine: (key: string, patch: Partial<EditableInvoiceLine>) => void
    readonly choosePreset: (lineKey: string, presetId: string) => void
    readonly deleteLine: (line: EditableInvoiceLine) => void
    readonly save: () => void
  }
}
