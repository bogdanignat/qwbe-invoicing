/**
 * The series choice of an invoice draft (T-2082). A new document is offered the
 * active series only. A saved draft whose series was archived since keeps
 * showing it, marked, so nothing is chosen for the user; it cannot be issued
 * until it is moved to an active series or the series is reactivated in Setări.
 */
export interface SeriesChoice {
  readonly value: string
  readonly label: string
}

export const draftSeriesChoices = (
  active: ReadonlyArray<string>,
  saved: string | undefined,
): ReadonlyArray<SeriesChoice> => [
  ...saved === undefined || active.includes(saved) ? [] : [{ value: saved, label: `${saved} (arhivată)` }],
  ...active.map((series) => ({ value: series, label: series })),
]

/** Why the chosen series cannot be issued in, or `undefined` while it is active. */
export const archivedSeriesNotice = (series: string, active: ReadonlyArray<string>): string | undefined =>
  active.includes(series)
    ? undefined
    : `Seria ${series} e arhivată: alege o serie activă pentru draft sau reactivează seria din Setări.`

/** The series part of an invoice authoring screen: what the select offers and why issuing is held back. */
export const draftSeriesState = (
  chosen: string,
  active: ReadonlyArray<string>,
  saved: string | undefined,
): { readonly choices: ReadonlyArray<SeriesChoice>; readonly warning: string | undefined } => ({
  choices: draftSeriesChoices(active, saved),
  warning: archivedSeriesNotice(chosen, active),
})
