import type { Dispatch, SetStateAction } from "react"
import {
  editBuyerFiscalIdentifier, newEditableInvoiceLine, preferredUnitOfMeasure,
  selectBuyerCounty, selectBuyerSector, switchPartyType,
  type EditableInvoiceLine, type InvoiceAuthoringForm,
} from "../lib/invoice-authoring-state.ts"
import type { Issuer, UnitOfMeasure, VatCatalogue } from "../lib/models.ts"
import { defaultVatCode } from "../lib/vat-defaults.ts"

interface AuthoringEditorActionsInput {
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly issueDate: string
  readonly setForm: Dispatch<SetStateAction<InvoiceAuthoringForm>>
  readonly setLines: Dispatch<SetStateAction<ReadonlyArray<EditableInvoiceLine>>>
}

export const createInvoiceAuthoringEditorActions = (input: AuthoringEditorActionsInput) => ({
  changeForm: (patch: Partial<InvoiceAuthoringForm>): void => {
    input.setForm((current) => ({ ...current, ...patch }))
  },
  choosePartyType: (partyType: InvoiceAuthoringForm["partyType"]): void => {
    input.setForm((current) => switchPartyType(current, partyType))
  },
  chooseCounty: (county: string): void => {
    input.setForm((current) => selectBuyerCounty(current, county))
  },
  changeFiscalIdentifier: (value: string): void => {
    input.setForm((current) => editBuyerFiscalIdentifier(current, value))
  },
  chooseSector: (sector: string): void => {
    input.setForm((current) => selectBuyerSector(current, sector))
  },
  addLine: (): void => {
    input.setLines((current) => [...current, newEditableInvoiceLine(
      crypto.randomUUID(),
      defaultVatCode(input.vatCatalogue, input.issuer, input.issueDate),
      preferredUnitOfMeasure(input.unitOfMeasures),
    )])
  },
  changeLine: (key: string, patch: Partial<EditableInvoiceLine>): void => {
    input.setLines((current) => current.map((line) =>
      line.key === key ? { ...line, ...patch } : line))
  },
})
