import Link from "next/link"
import type { ReactNode } from "react"

import { ErrorAlert, Loading } from "./AsyncState.tsx"
import { DocumentDownloads } from "./DocumentDownloads.tsx"
import { DocumentSnapshot } from "./DocumentSnapshot.tsx"
import { Page } from "./Page.tsx"
import type { DocumentDetailModel } from "../hooks/use-document-detail.ts"

interface DocumentDetailProps {
  readonly title: string
  readonly eyebrow: string
  readonly model: DocumentDetailModel
  /** The registry this document belongs to; invoices are the default because most documents are. */
  readonly backHref?: string
  readonly backLabel?: string
  /** Sections a particular document adds under its snapshot, such as a proforma's conversion. */
  readonly children?: ReactNode
}

/**
 * The download buttons stay out of the header until the document is loaded:
 * their file names come from the snapshot, so before it arrives there is
 * nothing to save under.
 */
export const DocumentDetail = ({
  title, eyebrow, model, backHref = "/invoices", backLabel = "← Înapoi la registru", children,
}: DocumentDetailProps) => <Page
  title={title}
  eyebrow={eyebrow}
  actions={model.view === undefined ? undefined : <DocumentDownloads actions={model.downloads} />}
>
  <p className="back-link"><Link href={backHref}>{backLabel}</Link></p>
  {model.downloads.map((action) => action.error === null
    ? null
    : <ErrorAlert key={action.key} error={action.error} />)}
  {model.view === undefined
    ? model.isPending ? <Loading label="Se încarcă documentul…" /> : <ErrorAlert error={model.error} onRetry={model.retry} />
    : <><DocumentSnapshot view={model.view} />{children}</>}
</Page>
