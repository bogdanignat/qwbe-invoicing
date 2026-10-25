import type { InvoiceAuthoringSessionInput } from "../../hooks/invoice-authoring-session-types.ts"
import { useDraftBuyer } from "../../hooks/use-draft-buyer.ts"
import { Loading } from "../AsyncState.tsx"
import { InvoiceAuthoringSession } from "./InvoiceAuthoringSession.tsx"

/**
 * Holds the form back only while the saved buyer of a draft without a due date
 * is read, so the due date it opens with uses that buyer's payment term. A
 * failed read does not block: the form opens on the issuer's term.
 */
export const InvoiceAuthoringOpening = (input: Omit<InvoiceAuthoringSessionInput, "draftBuyer">) => {
  const draftBuyer = useDraftBuyer(input.initialDraft)
  return draftBuyer.pending
    ? <Loading label="Se pregătește formularul…" />
    : <InvoiceAuthoringSession {...input} draftBuyer={draftBuyer.buyer} />
}
