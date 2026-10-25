import { dateTime } from "./format.ts"
import type { ReceivedFetch, ReceivedStatus } from "./received-models.ts"

/**
 * A fetch of received invoices as the page shows it while the dispatcher
 * carries it out in the background: `listing` → `downloading` → `completed`,
 * or `failed`. Only the first two are active, and only then is the status polled.
 */
export const RECEIVED_POLL_MS = 3_000

export const fetchActive = (fetch: ReceivedFetch | null | undefined): boolean =>
  fetch?.state === "listing" || fetch?.state === "downloading"

export const statusPollInterval = (status: ReceivedStatus | undefined): number | false =>
  fetchActive(status?.fetch) ? RECEIVED_POLL_MS : false

/** Whether the fetch seen active before is over in the answer after it: the moment the list is read again. */
export const fetchFinished = (previous: ReceivedFetch | null | undefined, next: ReceivedFetch | null): boolean =>
  previous !== null && previous !== undefined && fetchActive(previous) && (next?.id !== previous.id || !fetchActive(next))

/** The dispatcher's own failure codes (`cubes/invoicing/efactura/received/domain/fetching.ts`); anything else is ANAF's text. */
const FAILURES: ReadonlyMap<string, string> = new Map(Object.entries({
  neconectat: "Conexiunea ANAF nu mai este activă. Reconectează-te din Integrări.",
  conexiune_alt_cif: "Conexiunea ANAF este verificată pentru alt CIF decât cel al firmei.",
  fara_drept_cif: "ANAF spune că certificatul conectat nu are drept SPV pe CIF-ul firmei.",
  token_refuzat: "ANAF a refuzat tokenul conexiunii. Reconectează-te din Integrări.",
  fereastra_expirata: "Perioada cerută a ieșit din cele 60 de zile pe care le listează ANAF. Cere o preluare nouă.",
  anaf_indisponibil: "ANAF nu a răspuns clar nici după reîncercări. Reîncearcă mai târziu.",
}))

export const fetchFailureText = (error: string): string => FAILURES.get(error) ?? `ANAF: ${error}`

export type ProgressTone = "info" | "positive" | "warning"

export interface FetchProgressView {
  readonly active: boolean
  readonly tone: ProgressTone
  readonly text: string
  readonly errors: ReadonlyArray<string>
  /** Days before the window that ANAF no longer lists, said out loud. */
  readonly gap: string | undefined
}

const counts = (fetch: ReceivedFetch): string =>
  `găsite în SPV: ${String(fetch.found)}, noi: ${String(fetch.queued)}, eșuate: ${String(fetch.failed)}`

const progressText = (fetch: ReceivedFetch): string => {
  switch (fetch.state) {
    case "listing":
      return fetch.pagesTotal === 0
        ? "Preluare în curs: se cere lista mesajelor din SPV…"
        : `Preluare în curs: lista din SPV, pagina ${String(fetch.pagesListed)} din ${String(fetch.pagesTotal)}; găsite până acum: ${String(fetch.found)}.`
    case "downloading":
      return `Preluare în curs: descărcate ${String(fetch.downloaded)} din ${String(fetch.queued)} facturi noi; eșuate: ${String(fetch.failed)}.`
    case "completed":
      return fetch.failed === 0
        ? `Preluarea din ${dateTime(fetch.window.end)} s-a încheiat: ${counts(fetch)}.`
        : `Preluarea din ${dateTime(fetch.window.end)} s-a încheiat: ${counts(fetch)}. Facturile eșuate se reiau la următoarea preluare.`
    case "failed":
      return `Preluarea din ${dateTime(fetch.window.end)} nu s-a încheiat: ${counts(fetch)}.`
  }
}

const toneOf = (fetch: ReceivedFetch): ProgressTone => {
  if (fetchActive(fetch)) return "info"
  return fetch.state === "completed" && fetch.failed === 0 ? "positive" : "warning"
}

export const fetchProgressView = (fetch: ReceivedFetch): FetchProgressView => ({
  active: fetchActive(fetch),
  tone: toneOf(fetch),
  text: progressText(fetch),
  errors: fetch.errors.map(fetchFailureText),
  gap: fetch.window.gap === undefined
    ? undefined
    : `ANAF nu mai listează perioada ${dateTime(fetch.window.gap.from)} – ${dateTime(fetch.window.gap.until)}: facturile primite atunci nu pot fi preluate de aici.`,
})
