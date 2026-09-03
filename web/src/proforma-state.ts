export interface ProformaIssuanceAvailabilityInput {
  readonly hasSavedDraft: boolean
  readonly editable: boolean
  readonly synchronized: boolean
  readonly hasLines: boolean
  readonly workflowPending: boolean
  readonly issuancePending: boolean
  readonly hasSeries: boolean
}

export interface ProformaIssuanceAvailability {
  readonly visible: boolean
  readonly canIssue: boolean
  readonly disabledReason: string | null
}

export const proformaStatusLabel = (value: { readonly convertedDraftId: string | null; readonly convertedInvoiceId: string | null }): string =>
  value.convertedInvoiceId !== null ? "Facturată" : value.convertedDraftId !== null ? "Draft factură creat" : "Nefacturată"

export const proformaIssuanceAvailability = (input: ProformaIssuanceAvailabilityInput): ProformaIssuanceAvailability => {
  const visible = input.editable
  if (!visible) return { visible: false, canIssue: false, disabledReason: null }
  if (input.workflowPending || input.issuancePending) return { visible, canIssue: false, disabledReason: "Așteaptă finalizarea operației în curs." }
  if (input.hasSavedDraft && !input.synchronized) return { visible, canIssue: false, disabledReason: "Salvează modificările înainte de emiterea proformei." }
  if (!input.hasLines) return { visible, canIssue: false, disabledReason: "Completează cel puțin o linie înainte de emitere." }
  if (!input.hasSeries) return { visible, canIssue: false, disabledReason: "Configurează o serie de proformă înainte de emitere." }
  return { visible, canIssue: true, disabledReason: null }
}
