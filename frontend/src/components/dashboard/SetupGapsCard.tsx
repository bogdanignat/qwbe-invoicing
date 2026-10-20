import { useId } from "react"

import { AppLink } from "../ui/AppLink.tsx"
import type { SetupGap } from "../../lib/setup-gaps.ts"

/**
 * „Configurare incompletă”: what is still missing, each with the link to where
 * it is fixed. Shown only once the checks answered and something is missing; it
 * goes away by itself when the last gap is fixed.
 */
export const SetupGapsCard = ({ gaps }: { readonly gaps: ReadonlyArray<SetupGap> | undefined }) => {
  const headingId = useId()
  if (gaps === undefined || gaps.length === 0) return null
  return <section className="card" aria-labelledby={headingId}>
    <div className="section-heading">
      <div>
        <h2 id={headingId} className="text-invoice-danger-text">Configurare incompletă</h2>
        <p>Până completezi pașii de mai jos, unele documente sau integrări nu funcționează.</p>
      </div>
    </div>
    <ul className="m-0 grid list-none gap-2 p-0">
      {gaps.map((gap) => <li key={gap.code}
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-invoice-control border-l-3 border-invoice-danger bg-invoice-danger-soft px-4 py-3 text-sm text-invoice-danger-text">
        <span>{gap.message}</span>
        {gap.action === undefined ? null : <AppLink className="font-semibold underline underline-offset-2" href={gap.action.href}>{gap.action.label}</AppLink>}
      </li>)}
    </ul>
  </section>
}
