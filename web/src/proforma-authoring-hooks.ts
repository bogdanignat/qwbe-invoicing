import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "./api.ts"
import { today } from "./format.ts"
import {
  authoringDocumentPayload, authoringReadiness, documentNotesIssue, documentNotesMaxLength,
  editBuyerFiscalIdentifier, newAuthoringForm, newEditableInvoiceLine, preferredUnitOfMeasure, selectBuyerCounty, selectBuyerSector, switchPartyType,
  type EditableInvoiceLine, type InvoiceAuthoringForm,
} from "./invoice-authoring-state.ts"
import { useInvoiceAuthoringCustomers } from "./invoice-authoring-customers-hooks.ts"
import { useInvoiceAuthoringPresets } from "./invoice-authoring-presets-hooks.ts"
import { invoicingClient, type AuthoringProformaInput } from "./invoicing-client.ts"
import type { Customer, Issuer, UnitOfMeasure, VatCatalogue, VatRate } from "./models.ts"
import { navigate } from "./navigation.ts"
import { useOperationIdempotency } from "./operation-idempotency.ts"
import { defaultVatCode, issuerForIssueDate, presetVatCode, vatRatesForIssuer } from "./vat-defaults.ts"
import { authoringSeriesOptions } from "./invoice-authoring-state.ts"
import { useVatCatalogue } from "./vat-hooks.ts"
import { countyRequiresSector } from "./romanian-counties.ts"

export type ProformaAuthoringPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: Error }
  | { readonly kind: "issuer-required" }
  | { readonly kind: "vat-catalogue-empty" }
  | { readonly kind: "unit-catalogue-empty" }
  | {
      readonly kind: "ready"
      readonly issuer: Issuer
      readonly vatCatalogue: VatCatalogue
      readonly customers: ReadonlyArray<Customer>
      readonly proformaSeries: ReadonlyArray<string>
      readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
      readonly backgroundErrors: ReadonlyArray<Error>
    }

export const useProformaAuthoringPage = (): ProformaAuthoringPageState => {
  const vatCatalogue = useVatCatalogue()
  const customers = useQuery({ queryKey: ["customers", "proforma-authoring"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers({ limit: 200 }), signal) })
  const issuer = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const series = useQuery({ queryKey: ["document-series"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listDocumentSeries(), signal) })
  const units = useQuery({ queryKey: ["unit-of-measures"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listUnitOfMeasures(), signal) })
  const requiredPending = (issuer.data === undefined && issuer.isPending) || (vatCatalogue.data === undefined && vatCatalogue.isPending)
    || (series.data === undefined && series.isPending) || (units.data === undefined && units.isPending)
    || (customers.data === undefined && customers.isPending)
  if (requiredPending) return { kind: "loading" }
  const blockingError = issuer.data === undefined ? issuer.error : vatCatalogue.data === undefined ? vatCatalogue.error
    : series.data === undefined ? series.error : units.data === undefined ? units.error : null
  if (blockingError !== null) return { kind: "error", error: blockingError }
  if (issuer.data === null || issuer.data === undefined) return { kind: "issuer-required" }
  if (vatCatalogue.data === undefined) return { kind: "vat-catalogue-empty" }
  if ((units.data ?? []).length === 0) return { kind: "unit-catalogue-empty" }
  return {
    kind: "ready", issuer: issuer.data, vatCatalogue: vatCatalogue.data, customers: customers.data?.items ?? [],
    proformaSeries: authoringSeriesOptions(series.data ?? []).proforma, unitOfMeasures: units.data ?? [],
    backgroundErrors: [customers.error, issuer.error, vatCatalogue.error, series.error, units.error].filter((error): error is Error => error !== null),
  }
}

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
  readonly status: { readonly pending: boolean; readonly canSave: boolean; readonly seriesMissing: boolean }
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

const proformaPayload = (form: InvoiceAuthoringForm, lines: ReadonlyArray<EditableInvoiceLine>): AuthoringProformaInput => {
  const { series: proformaSeries, ...document } = authoringDocumentPayload(form, lines)
  return { ...document, proformaSeries }
}

export const useProformaAuthoringSession = (input: ProformaAuthoringSessionInput): ProformaAuthoringSessionViewModel => {
  const queryClient = useQueryClient()
  const idempotency = useOperationIdempotency()
  const initialDate = today()
  const [form, setForm] = useState(() => newAuthoringForm(input.issuer, input.proformaSeries[0] ?? "", input.customers.length > 0, initialDate))
  const [lines, setLines] = useState<ReadonlyArray<EditableInvoiceLine>>(() => [newEditableInvoiceLine(
    crypto.randomUUID(), defaultVatCode(input.vatCatalogue, input.issuer, initialDate), preferredUnitOfMeasure(input.unitOfMeasures),
  )])
  const customers = useInvoiceAuthoringCustomers({ customers: input.customers, issuer: input.issuer, deriveDueDate: true, setForm })
  const presets = useInvoiceAuthoringPresets({
    setLines, vatCodeFor: (preferred) => presetVatCode(preferred, input.vatCatalogue, input.issuer, form.issueDate),
  })
  const readiness = authoringReadiness(form, lines, undefined, false)
  const mutation = useMutation({
    mutationFn: (request: { readonly payload: AuthoringProformaInput; readonly fingerprint: string }) => runUiEffect(invoicingClient.issueProforma(request.payload, idempotency.current("create-proforma", request.fingerprint))),
    onSuccess: async (proforma) => {
      idempotency.complete("create-proforma")
      navigate(`/proformas/${encodeURIComponent(proforma.id)}`)
      await queryClient.invalidateQueries({ queryKey: ["proformas"] })
    },
    onError: (error, request) => { idempotency.fail("create-proforma", request.fingerprint, error) },
  })
  const canSave = readiness.hasLines && form.series !== "" && !mutation.isPending && documentNotesIssue(form.notes) === null
  return {
    document: { issuer: issuerForIssueDate(input.issuer, form.issueDate), customers: input.customers, proformaSeries: input.proformaSeries, unitOfMeasures: input.unitOfMeasures,
      form, lines, buyerSectorRequired: countyRequiresSector(form.county), productPresets: presets.presets, vatRates: vatRatesForIssuer(input.vatCatalogue, input.issuer, form.issueDate) },
    feedback: { backgroundErrors: [...input.backgroundErrors, presets.error].filter((error): error is Error => error !== null),
      mutationError: mutation.error, issuerWarning: customers.issuerWarning, notesIssue: documentNotesIssue(form.notes), notesMaxLength: documentNotesMaxLength },
    status: { pending: mutation.isPending, canSave, seriesMissing: input.proformaSeries.length === 0 },
    actions: {
      changeForm: (patch) => { setForm((current) => ({ ...current, ...patch })) },
      chooseBuyerMode: customers.chooseBuyerMode, chooseCustomer: customers.chooseCustomer,
      chooseIssueDate: customers.chooseIssueDate, chooseDueDate: customers.chooseDueDate,
      choosePartyType: (partyType) => { setForm((current) => switchPartyType(current, partyType)) },
      chooseCounty: (county) => { setForm((current) => selectBuyerCounty(current, county)) },
      changeFiscalIdentifier: (value) => { setForm((current) => editBuyerFiscalIdentifier(current, value)) },
      chooseSector: (sector) => { setForm((current) => selectBuyerSector(current, sector)) },
      addLine: () => { setLines((current) => [...current, newEditableInvoiceLine(crypto.randomUUID(), defaultVatCode(input.vatCatalogue, input.issuer, form.issueDate), preferredUnitOfMeasure(input.unitOfMeasures))]) },
      changeLine: (key, patch) => { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)) },
      choosePreset: presets.choosePreset,
      deleteLine: (line) => { setLines((current) => current.filter((item) => item.key !== line.key)) },
      save: () => {
        if (!canSave || !window.confirm("Salvezi proforma? Va primi un număr și va deveni un document comercial imuabil, nefiscal.")) return
        const payload = proformaPayload(form, lines)
        mutation.mutate({ payload, fingerprint: JSON.stringify(payload) })
      },
    },
  }
}
