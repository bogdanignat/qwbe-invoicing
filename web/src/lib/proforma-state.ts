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

export interface ProformaStatusPresentation {
  readonly label: "Nefacturată" | "Draft factură creat" | "Facturată"
  readonly tone: "muted" | "info" | "positive"
}

export const proformaStatusPresentation = (value: { readonly convertedDraftId: string | null; readonly convertedInvoiceId: string | null }): ProformaStatusPresentation => {
  if (value.convertedInvoiceId !== null) return { label: "Facturată", tone: "positive" }
  if (value.convertedDraftId !== null) return { label: "Draft factură creat", tone: "info" }
  return { label: "Nefacturată", tone: "muted" }
}

export const proformaIssuanceAvailability = (input: ProformaIssuanceAvailabilityInput): ProformaIssuanceAvailability => {
  const visible = input.editable
  if (!visible) return { visible: false, canIssue: false, disabledReason: null }
  if (input.workflowPending || input.issuancePending) return { visible, canIssue: false, disabledReason: "Așteaptă finalizarea operației în curs." }
  if (input.hasSavedDraft && !input.synchronized) return { visible, canIssue: false, disabledReason: "Salvează modificările înainte de emiterea proformei." }
  if (!input.hasLines) return { visible, canIssue: false, disabledReason: "Completează cel puțin o linie înainte de emitere." }
  if (!input.hasSeries) return { visible, canIssue: false, disabledReason: "Configurează o serie de proformă înainte de emitere." }
  return { visible, canIssue: true, disabledReason: null }
}
