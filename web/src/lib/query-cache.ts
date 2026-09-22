import type { QueryClient } from "@tanstack/react-query"

interface ExactDraftQueryFilter {
  readonly queryKey: readonly ["draft", string]
  readonly exact: true
}

type Schedule = (callback: () => void) => void

export const exactDraftQuery = (draftId: string): ExactDraftQueryFilter => ({ queryKey: ["draft", draftId], exact: true })

export const evictDraftAfterNavigation = (
  draftId: string,
  removeQueries: (filter: ExactDraftQueryFilter) => void,
  schedule: Schedule = (callback) => { window.setTimeout(callback, 0) },
): void => {
  schedule(() => { removeQueries(exactDraftQuery(draftId)) })
}

export const invoiceRegisterQueryKey = ["invoice-register"] as const

export const invalidateInvoiceRegister = (queryClient: QueryClient): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })

export const invalidateInvoiceAfterCorrection = async (
  queryClient: QueryClient,
  invoiceId: string,
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] }),
    invalidateInvoiceRegister(queryClient),
  ])
}
