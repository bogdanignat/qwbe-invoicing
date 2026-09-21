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
