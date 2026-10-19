import { Button } from "../Button.tsx"
import type { CompanyLookupModel } from "../../hooks/use-company-lookup.ts"
import type { CompanyProposal } from "../../lib/company-lookup-model.ts"
import {
  proposalAddressReference, proposalHeadline, proposalVatLine, proposalWarnings, type ProposalVatUse,
} from "../../lib/company-proposal-view.ts"

interface CompanyProposalCardProps {
  readonly lookup: CompanyLookupModel
  readonly vat: ProposalVatUse
  readonly disabled: boolean
  /** Copies the proposal into the form; the card then steps aside for this CUI. */
  readonly onApply: (proposal: CompanyProposal) => void
}

/**
 * What a CUI lookup found, offered and never applied on its own: the form
 * changes only on "Completează". The other outcomes are one discreet line, and
 * none of them stops the form from being filled in and saved by hand.
 */
export const CompanyProposalCard = ({ lookup, vat, disabled, onApply }: CompanyProposalCardProps) => {
  const { outcome } = lookup
  if (outcome.kind === "idle" || outcome.kind === "applied") return null
  if (outcome.kind === "pending") return <p className="hint span-two" role="status">Se caută firma…</p>
  if (outcome.kind === "not-found") return <p className="hint span-two" role="status">Nu am găsit firma.</p>
  if (outcome.kind === "failed") return <p className="hint warning span-two" role="status">{outcome.message}</p>
  const { proposal } = outcome
  const address = proposalAddressReference(proposal)
  return <section className="span-two grid gap-2 rounded-invoice-control border border-invoice-border bg-invoice-primary-soft p-3"
    aria-label="Firmă găsită">
    <p className="m-0 font-bold text-invoice-ink" role="status">{proposalHeadline(proposal)}</p>
    {proposalWarnings(proposal).map((warning) => <p key={warning} className="hint warning">{warning}</p>)}
    <p className="hint">{proposalVatLine(proposal, vat)}</p>
    {address === undefined ? null : <p className="hint">{address}</p>}
    <div>
      <Button className="small" disabled={disabled} onClick={() => { onApply(proposal); lookup.applied(proposal) }}>
        Completează
      </Button>
    </div>
  </section>
}
