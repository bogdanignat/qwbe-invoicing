"use client"

import { ErrorAlert } from "../components/AsyncState.tsx"
import { DocumentDetail } from "../components/DocumentDetail.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { ProformaConversionSection } from "../components/ProformaConversionSection.tsx"
import { OperationRecoveryNotice } from "../components/authoring/OperationRecoveryNotice.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useProformaDetail } from "../hooks/use-proforma-detail.ts"

/**
 * A proforma reads like any other document and then offers what only a proforma
 * can: becoming an invoice, or a draft to finish first.
 *
 * The unresolved-write card comes before the conversion: a conversion whose
 * answer was lost must be replayed or acknowledged from here, under the key it
 * left with, rather than started again as a second conversion.
 */
export const ProformaDetailView = ({ id }: { readonly id: string }) => {
  const shell = useAuthenticatedShell()
  const { detail, conversion } = useProformaDetail(id)
  return <PrivateScreen shell={shell}>
    <DocumentDetail
      title="Proformă" eyebrow="Document comercial" model={detail}
      backHref="/proformas" backLabel="← Înapoi la proforme"
    >
      <OperationRecoveryNotice
        notice={conversion.notice} pending={conversion.noticePending}
        onReplay={conversion.replay} onDismiss={conversion.dismiss}
      />
      {conversion.error === null || conversion.error === undefined
        ? null
        : <ErrorAlert error={conversion.error} />}
      <ProformaConversionSection conversion={conversion} />
    </DocumentDetail>
  </PrivateScreen>
}
