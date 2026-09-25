"use client"

import Link from "next/link"

import { Button } from "../Button.tsx"
import { DISMISS_LABEL, REPLAY_LABEL, type RecoveryNoticeModel } from "../../lib/operation-recovery-view.ts"
import type { RecoveryRecord } from "../../lib/operation-recovery-types.ts"

interface OperationRecoveryNoticeProps {
  readonly notice: RecoveryNoticeModel | undefined
  readonly pending: boolean
  readonly onReplay: (record: RecoveryRecord) => void
  readonly onDismiss: () => void
}

/**
 * The unresolved write, shown. Nothing is sent from here on its own: the replay
 * is a button, and the warning closes only when the user states they checked
 * the registry.
 */
export const OperationRecoveryNotice = ({ notice, pending, onReplay, onDismiss }: OperationRecoveryNoticeProps) => {
  if (notice === undefined) return null
  const record = notice.replay
  return <section className="card authoring-section status-note warning" role="alert">
    <h2>{notice.title}</h2>
    <p>{notice.message}</p>
    {notice.details.length === 0
      ? null
      : <dl className="recovery-summary">
        {notice.details.map((detail) => <div key={detail.label}>
          <dt>{detail.label}</dt><dd>{detail.value}</dd>
        </div>)}
      </dl>}
    <p><Link href={notice.link?.href ?? "/invoices"}>{notice.link?.label ?? "Deschide registrul de facturi"}</Link></p>
    {record === undefined
      ? null
      : <Button className="full-width" disabled={pending} onClick={() => { onReplay(record) }}>
        {pending ? "Se retrimite…" : REPLAY_LABEL}
      </Button>}
    {notice.dismissible
      ? <Button className="secondary full-width" onClick={onDismiss}>{DISMISS_LABEL}</Button>
      : null}
  </section>
}
