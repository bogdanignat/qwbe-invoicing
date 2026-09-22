import { useMutation, useQueryClient } from "@tanstack/react-query"

import { runUiEffect } from "../lib/api.ts"
import { formField, type FormSubmitEvent } from "../lib/form.ts"
import { invoiceActionState } from "../lib/invoice-state.ts"
import { invoicingClient } from "../lib/invoicing-client.ts"
import type { CorrectionDocument, PaymentSummary } from "../lib/models.ts"
import { invalidateInvoiceAfterCorrection } from "../lib/query-cache.ts"
import { useIdempotencyKey } from "./idempotency-key.ts"

interface CorrectionCreationInput {
  readonly invoiceId: string
  readonly corrections: ReadonlyArray<CorrectionDocument>
  readonly paymentSummary: PaymentSummary
  readonly notify: (message: string) => void
}

export const useCorrectionCreation = (input: CorrectionCreationInput) => {
  const queryClient = useQueryClient()
  const idempotency = useIdempotencyKey()
  const state = invoiceActionState(input.paymentSummary, input.corrections)
  const create = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) =>
      runUiEffect(invoicingClient.createCorrection(input.invoiceId, body, idempotency.current())),
    onSuccess: async () => {
      idempotency.complete()
      await invalidateInvoiceAfterCorrection(queryClient, input.invoiceId)
      input.notify("Documentul storno a fost emis.")
    },
    onError: idempotency.fail,
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    if (!window.confirm("Emiți un document storno integral? Documentul va fi fiscal și imuabil.")) return
    const form = event.currentTarget
    create.mutate({ reason: formField(form, "reason"), issueDate: formField(form, "issueDate") })
  }
  return { state, create, submit }
}
