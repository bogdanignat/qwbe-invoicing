import type { EFacturaCandidate, EFacturaCandidates, EFacturaHistory, EFacturaSubmission, FiscalState } from "./efactura-submissions.ts"
import { submissionMessages } from "./efactura-wait-codes.ts"
import { dateTime } from "./format.ts"

/**
 * The submission history and the reconciliation candidates as rows, every
 * field already text: the panel only renders them. Each row is named by its
 * moment, so the repeated buttons on it get names a screen reader can tell apart.
 */
const STATE_LABELS: Readonly<Record<FiscalState, string>> = {
  queued: "În coadă",
  validating: "Se validează",
  uploading: "Se încarcă la ANAF",
  processing: "În procesare la ANAF",
  accepted: "Acceptată",
  rejected: "Respinsă",
  refused: "Refuzată",
  unknown: "Necunoscut",
}

export interface SubmissionRow {
  readonly id: string
  readonly anchorId: string
  readonly title: string
  readonly stateLine: string
  readonly uploadIndex: string | undefined
  readonly errors: ReadonlyArray<string>
  readonly replacedBy: { readonly href: string; readonly label: string } | undefined
  readonly replaces: { readonly href: string; readonly label: string } | undefined
  /** The current submission's files are offered above the history, so its row repeats none. */
  readonly files: boolean
  /** Accessible names that keep the visible text and add which submission they belong to. */
  readonly xmlLabel: string
  readonly responseLabel: string | undefined
}

export const submissionAnchor = (id: string): string => `efactura-submission-${id}`
const title = (submission: EFacturaSubmission): string => `Trimiterea din ${dateTime(submission.createdAt)}`

const link = (submission: EFacturaSubmission | undefined, prefix: string) => submission === undefined
  ? undefined
  : { href: `#${submissionAnchor(submission.id)}`, label: `${prefix} ${title(submission).toLocaleLowerCase("ro-RO")}` }

export const historyRows = (history: EFacturaHistory): ReadonlyArray<SubmissionRow> => {
  const byId = new Map(history.submissions.map((submission) => [submission.id, submission]))
  return history.submissions.map((submission) => {
    const next = history.resubmissions.find((pair) => pair.previousId === submission.id)
    const previous = history.resubmissions.find((pair) => pair.nextId === submission.id)
    const name = title(submission)
    return {
      id: submission.id,
      anchorId: submissionAnchor(submission.id),
      title: name,
      stateLine: `Stare: ${STATE_LABELS[submission.state]}${submission.environment === "test" ? " · ANAF TEST" : ""}`,
      uploadIndex: submission.uploadIndex ?? undefined,
      errors: submissionMessages(submission),
      replacedBy: link(next === undefined ? undefined : byId.get(next.nextId), "Înlocuită de"),
      replaces: link(previous === undefined ? undefined : byId.get(previous.previousId), "Înlocuiește"),
      files: submission.id !== history.current?.id,
      xmlLabel: `Descarcă XML trimis, ${name.toLocaleLowerCase("ro-RO")}`,
      responseLabel: submission.archiveState === "stored" ? `Descarcă răspunsul ANAF, ${name.toLocaleLowerCase("ro-RO")}` : undefined,
    }
  })
}

export interface CandidateRow {
  readonly uploadIndex: string
  readonly date: string
  readonly type: string
  readonly linked: boolean
  readonly linkLabel: string
}

const candidateRows = (candidates: ReadonlyArray<EFacturaCandidate>): ReadonlyArray<CandidateRow> =>
  candidates.map((candidate) => ({
    uploadIndex: candidate.uploadIndex,
    date: dateTime(candidate.createdAt),
    type: candidate.type,
    linked: candidate.linked,
    linkLabel: candidate.linked ? `Indexul ${candidate.uploadIndex} este deja legat` : `Leagă indexul ${candidate.uploadIndex}`,
  }))

export const linkConfirm = (uploadIndex: string): string => [
  `Confirm că acest mesaj ANAF este factura mea (indexul ${uploadIndex}).`,
  "Aplicația nu poate dovedi potrivirea: o legare greșită atașează documentului răspunsul ANAF al altui document.",
].join("\n\n")

export const RESUBMIT_CONFIRM = [
  "Retrimiți documentul în e-Factura?",
  "Lipsa lui din lista ANAF nu dovedește că nu a fost trimis: dacă prima încărcare a ajuns totuși la ANAF, documentul poate apărea de două ori (duplicat).",
  "Confirm că vreau să-l retrimit.",
].join("\n\n")

export interface CandidatesView {
  readonly rows: ReadonlyArray<CandidateRow>
  readonly window: string
  /** Shown only when ANAF has more than one page. */
  readonly pageLabel: string | undefined
  readonly previous: number | undefined
  readonly next: number | undefined
}

export const candidatesView = (answer: EFacturaCandidates): CandidatesView => ({
  rows: candidateRows(answer.candidates),
  window: `Mesajele ANAF între ${dateTime(answer.from)} și ${dateTime(answer.to)}.`,
  pageLabel: answer.pages > 1 ? `Pagina ${String(answer.page)} din ${String(answer.pages)}` : undefined,
  previous: answer.page > 1 ? answer.page - 1 : undefined,
  next: answer.page < answer.pages ? answer.page + 1 : undefined,
})
