import { dateTime } from "./format.ts"

/**
 * „Ultima acoperire” of the received invoices: up to when they are fetched
 * completely, read from the server's checkpoint (`coveredUntil`), never from
 * the last click. ANAF lists at most 60 days back from the moment of the
 * request (`docs/EFACTURA.md`, ANAF TEST 2026-10-23), so past 50 days the page
 * warns before days fall out of reach, and past 60 it says they did.
 */
const DAY_MS = 86_400_000
export const LISTABLE_DAYS = 60
export const COVERAGE_WARNING_DAYS = 50

export interface CoverageView {
  readonly text: string
  readonly warning: string | undefined
}

const FIRST_FETCH = "Nicio preluare completă încă. Prima preluare aduce facturile primite din ultimele 60 de zile: "
  + "mai în urmă ANAF nu listează."

export const coverageView = (coveredUntil: string | null, now: Date): CoverageView => {
  if (coveredUntil === null) return { text: FIRST_FETCH, warning: undefined }
  const text = `Ultima acoperire: facturile primite sunt preluate complet până la ${dateTime(coveredUntil)}.`
  const elapsed = now.getTime() - Date.parse(coveredUntil)
  if (!(elapsed > COVERAGE_WARNING_DAYS * DAY_MS)) return { text, warning: undefined }
  const days = Math.floor(elapsed / DAY_MS)
  const since = `Au trecut ${String(days)} de zile de la ultima acoperire.`
  const warning = elapsed > LISTABLE_DAYS * DAY_MS
    ? `${since} ANAF listează doar ultimele 60 de zile: facturile primite înainte de atât nu mai pot fi preluate de aici.`
    : `${since} ANAF listează cel mult 60 de zile în urmă: preia acum, ca să nu rămână zile nepreluate.`
  return { text, warning }
}
