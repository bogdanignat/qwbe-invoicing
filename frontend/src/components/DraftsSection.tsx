"use client"

import Link from "next/link"

import { Button } from "./Button.tsx"
import { EmptyState, ErrorAlert, Loading } from "./AsyncState.tsx"
import { LoadMore } from "./LoadMore.tsx"
import type { DraftsListModel } from "../hooks/use-drafts.ts"
import { money } from "../lib/format.ts"

/**
 * The drafts area of the invoices screen, with states of its own: a failing or
 * empty draft list never blanks the issued-document register above it, and the
 * register's filters do not reach into it.
 */
export const DraftsSection = ({ drafts }: { readonly drafts: DraftsListModel }) => <section className="card">
  <div className="section-heading">
    <div>
      <h2>Drafturi</h2>
      <p>Documente neterminate, salvate pe server. Deschide un draft pentru a continua editarea sau emiterea.</p>
    </div>
  </div>
  {drafts.items === undefined
    ? drafts.isPending
      ? <Loading label="Se încarcă drafturile…" />
      : <ErrorAlert error={drafts.error} onRetry={drafts.retry} />
    : drafts.items.length === 0
      ? <EmptyState>Nu există drafturi salvate.</EmptyState>
      : <>
        {drafts.error === null || drafts.error === undefined ? null : <ErrorAlert error={drafts.error} onRetry={drafts.retry} />}
        {drafts.removalError === null || drafts.removalError === undefined ? null : <ErrorAlert error={drafts.removalError} />}
        <div>
          {drafts.items.map((draft) => <div className="draft-item" key={draft.id}>
            <div className="draft-item-main">
              <Link href={`/drafts/${encodeURIComponent(draft.id)}`}><strong>{draft.customer.name}</strong></Link>
              <small>
                Serie {draft.series} · {draft.issueDate}
                {draft.dueDate === null ? "" : ` · scadență ${draft.dueDate}`} · {draft.lines.length}{" "}linii · {money(draft.totalIncludingVat, draft.currency)}
              </small>
            </div>
            <div className="draft-item-actions">
              <Link className="button secondary small" href={`/drafts/${encodeURIComponent(draft.id)}`}>Deschide</Link>
              {drafts.canDeleteDraft(draft)
                ? <Button className="danger small" disabled={drafts.removalPending} onClick={() => { drafts.removeDraft(draft) }}>Șterge</Button>
                : null}
            </div>
          </div>)}
        </div>
        <LoadMore visible={drafts.hasMore} pending={drafts.loadingMore} onClick={drafts.loadMore} />
      </>}
</section>
