import type { Dispatch, SetStateAction } from "react"

import type { Customer, Issuer, ProductPreset, UnitOfMeasure, VatCatalogue } from "../lib/draft-models.ts"
import { newEditableInvoiceLine, preferredUnitOfMeasure } from "../lib/invoice-authoring-model.ts"
import type { BuyerMode, EditableInvoiceLine, InvoiceAuthoringForm, PartyType } from "../lib/invoice-authoring-model.ts"
import {
  editBuyerFiscalIdentifier, editDueDate, selectBuyerCounty, selectBuyerMode, selectBuyerSector,
  selectIssueDate, selectSavedCustomer, selectedSavedCustomer, switchPartyType,
} from "../lib/invoice-authoring-transitions.ts"
import { choosePresetForLine } from "../lib/invoice-authoring-options.ts"
import { defaultVatCode, presetVatCode } from "../lib/vat-defaults.ts"

export interface EditorActionsInput {
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly productPresets: ReadonlyArray<ProductPreset>
  readonly customers: ReadonlyArray<Customer>
  readonly issueDate: string
  /** A saved draft owns its due date; an unsaved document still derives it from the payment terms. */
  readonly deriveDueDate: boolean
  readonly setForm: Dispatch<SetStateAction<InvoiceAuthoringForm>>
  readonly setLines: Dispatch<SetStateAction<ReadonlyArray<EditableInvoiceLine>>>
}

/**
 * Every form and line edit the authoring screen offers, as pure state
 * transitions over the two states the session holds. Nothing here talks to the
 * network; saving and issuing are the draft and issuance controllers' work.
 */
export const createInvoiceAuthoringEditorActions = (input: EditorActionsInput) => ({
  changeForm: (patch: Partial<InvoiceAuthoringForm>): void => {
    input.setForm((current) => ({ ...current, ...patch }))
  },
  chooseBuyerMode: (buyerMode: BuyerMode): void => {
    input.setForm((current) => selectBuyerMode(current, buyerMode, input.customers, input.issuer, input.deriveDueDate))
  },
  chooseCustomer: (customerId: string): void => {
    input.setForm((current) => selectSavedCustomer(
      current, customerId, input.customers.find((customer) => customer.id === customerId), input.issuer, input.deriveDueDate,
    ))
  },
  chooseIssueDate: (issueDate: string): void => {
    input.setForm((current) => selectIssueDate(
      current, issueDate, selectedSavedCustomer(current, input.customers), input.issuer, input.deriveDueDate,
    ))
  },
  chooseDueDate: (dueDate: string): void => {
    input.setForm((current) => editDueDate(current, dueDate))
  },
  choosePartyType: (partyType: PartyType): void => {
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
    input.setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  },
  choosePreset: (lineKey: string, presetId: string): void => {
    const preset = input.productPresets.find((item) => item.id === presetId)
    if (preset === undefined) return
    input.setLines((current) => choosePresetForLine(
      current, lineKey, preset,
      presetVatCode(preset.preferredVatRateCode, input.vatCatalogue, input.issuer, input.issueDate),
    ))
  },
})
