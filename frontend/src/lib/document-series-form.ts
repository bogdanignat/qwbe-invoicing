import type { DocumentSeries, DocumentType } from "./draft-models.ts"
import type { DocumentSeriesInput } from "./settings-client.ts"

/**
 * The only write the series card performs, and the rules over it.
 *
 * Configuring a series is add-only by design: a series that has numbered a
 * document cannot be renamed or removed without breaking the numbering it
 * guarantees, so the screen offers no edit and no delete. What it does offer is
 * an early refusal of the two things the backend would reject anyway — a series
 * outside the accepted alphabet, and one that already exists for that document
 * type — because a `document_series_exists` failure reads worse than a sentence
 * under the field.
 */
export const SERIES_MAX_LENGTH = 20
export const SERIES_PATTERN = "[A-Z0-9][A-Z0-9_\\-]{0,19}"

const SERIES = new RegExp(`^${SERIES_PATTERN}$`, "u")

export const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  invoice: "Factură",
  proforma: "Proformă",
}

export interface DocumentSeriesForm {
  readonly documentType: DocumentType
  readonly series: string
}

export const newDocumentSeriesForm = (): DocumentSeriesForm => ({ documentType: "invoice", series: "" })

export type DocumentSeriesField = "documentType" | "series"

export type DocumentSeriesValidation =
  | { readonly kind: "ready"; readonly payload: DocumentSeriesInput }
  | { readonly kind: "issue"; readonly field: DocumentSeriesField; readonly message: string }

/** The `<select>` carries a string; only the two document types survive it. */
export const documentTypeValue = (value: string): DocumentType => value === "proforma" ? "proforma" : "invoice"

/** Series are stored upper-case, so the field shows what will be sent while it is typed. */
export const seriesInputValue = (value: string): string => value.toLocaleUpperCase("ro-RO")

export const documentSeriesPayload = (
  form: DocumentSeriesForm,
  existing: ReadonlyArray<DocumentSeries>,
): DocumentSeriesValidation => {
  const series = seriesInputValue(form.series.trim())
  if (series === "") return { kind: "issue", field: "series", message: "Seria este obligatorie." }
  if (!SERIES.test(series)) {
    return {
      kind: "issue",
      field: "series",
      message: "Seria are 1–20 de caractere: litere mari, cifre, „_” sau „-”, și începe cu o literă sau o cifră.",
    }
  }
  if (existing.some((item) => item.documentType === form.documentType && item.series === series)) {
    return {
      kind: "issue",
      field: "series",
      message: `Seria ${series} există deja pentru ${DOCUMENT_TYPE_LABELS[form.documentType].toLocaleLowerCase("ro-RO")}.`,
    }
  }
  return { kind: "ready", payload: { documentType: form.documentType, series } }
}

export const documentSeriesNotice = (created: DocumentSeries): string =>
  `Seria ${created.series} pentru ${DOCUMENT_TYPE_LABELS[created.documentType].toLocaleLowerCase("ro-RO")} a fost adăugată.`
