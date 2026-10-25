import { DOCUMENT_TYPE_LABELS } from "./document-series-form.ts"
import type { DocumentSeries } from "./draft-models.ts"

/**
 * The words of archiving a series (T-2082). An archived series takes no new
 * document and issues nothing, while its numbering and its documents stay, so
 * reactivating it continues the count. Every row names its own series in the
 * action, so a screen reader hears "Arhivează seria FCT de factură", not N
 * identical buttons.
 */
const typeLabel = (series: Pick<DocumentSeries, "documentType">): string =>
  DOCUMENT_TYPE_LABELS[series.documentType].toLocaleLowerCase("ro-RO")

export const seriesKey = (series: Pick<DocumentSeries, "documentType" | "series">): string =>
  `${series.documentType}:${series.series}`

export const seriesStateLabel = (series: Pick<DocumentSeries, "archived">): string =>
  series.archived ? "Arhivată" : "Activă"

export const archiveActionText = (series: Pick<DocumentSeries, "archived">): string =>
  series.archived ? "Reactivează" : "Arhivează"

/** While its toggle is in flight the row says so, still naming its own series. */
export const archiveActionLabel = (
  series: Pick<DocumentSeries, "documentType" | "series" | "archived">,
  busy = false,
): string => `${busy ? "Se salvează" : archiveActionText(series)} seria ${series.series} de ${typeLabel(series)}`

export const archiveNotice = (series: Pick<DocumentSeries, "documentType" | "series" | "archived">): string =>
  series.archived
    ? `Seria ${series.series} de ${typeLabel(series)} a fost arhivată: nu mai primește documente noi.`
    : `Seria ${series.series} de ${typeLabel(series)} a fost reactivată.`
