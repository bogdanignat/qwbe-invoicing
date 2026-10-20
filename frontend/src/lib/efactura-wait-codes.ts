import type { EFacturaSubmission } from "./efactura-submissions.ts"

/**
 * Why a queued submission waits. The dispatcher writes these codes into
 * `errors` until the submission leaves the queue; they are not ANAF's words,
 * so the panel and the history read them as the same sentences, from here.
 */
const WAIT_REASONS: ReadonlyMap<string, string> = new Map(Object.entries({
  neconectat: "Trimiterea așteaptă: aplicația nu are o conexiune ANAF utilizabilă. Reconectează-te din Setări → Integrări.",
  conexiune_alt_cif: "Trimiterea așteaptă: conexiunea ANAF este verificată pentru alt CIF decât cel de pe document.",
}))

/** The first wait code of a queued submission, as a sentence; `undefined` when it does not wait on one. */
export const waitReason = (submission: EFacturaSubmission): string | undefined => submission.state === "queued"
  ? submission.errors.map((code) => WAIT_REASONS.get(code)).find((reason) => reason !== undefined)
  : undefined

/** A submission's messages: wait codes as sentences on a queued one, ANAF's own words otherwise. */
export const submissionMessages = (submission: EFacturaSubmission): ReadonlyArray<string> => submission.state === "queued"
  ? submission.errors.map((code) => WAIT_REASONS.get(code) ?? code)
  : submission.errors
