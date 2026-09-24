"use client"

import Link from "next/link"

import { OperationRecoveryNotice } from "./OperationRecoveryNotice.tsx"
import { useAuthoringRecovery } from "../../hooks/use-authoring-recovery.ts"

interface LockedDraftReadonlyProps {
  readonly title: string
  readonly notice: string
  readonly registryHref: string
  readonly registryLabel: string
}

/**
 * A draft that can no longer be edited — issued, or issued as a proforma.
 *
 * The recovery notice belongs here too. An issuance whose answer was lost and
 * then confirmed by a refetch lands exactly on this screen: the journal still
 * holds the unresolved intent, and without the card the only way to replay or
 * dismiss it would be to find another editable authoring route by hand.
 */
export const LockedDraftReadonly = ({ title, notice, registryHref, registryLabel }: LockedDraftReadonlyProps) => {
  const recovery = useAuthoringRecovery()
  return <>
    <OperationRecoveryNotice
      notice={recovery.notice} pending={recovery.pending}
      onReplay={recovery.replay} onDismiss={recovery.dismiss}
    />
    <div className="card">
      <h2>{title}</h2>
      <p>{notice}</p>
      {/* The link is styled as a button: inside a paragraph its box overflows the
          line and lands on the text above, so it sits in the same action row the
          rest of the app uses. */}
      <div className="page-actions">
        <Link className="button secondary" href={registryHref}>{registryLabel}</Link>
      </div>
    </div>
  </>
}
