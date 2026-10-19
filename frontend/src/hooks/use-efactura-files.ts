import { useMutation } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { downloadBlob, documentFilename } from "../lib/browser-download.ts"
import type { EFacturaClient } from "../lib/efactura-client.ts"
import { efacturaFailure } from "../lib/efactura-feedback.ts"

export type EFacturaFile = "xml" | "zip"

export interface EFacturaFilesModel {
  /** `<submission>:<file>` of the download in flight, so only its button reads as pending. */
  readonly pendingKey: string | undefined
  readonly failure: Error | undefined
  readonly download: (submissionId: string, file: EFacturaFile) => void
}

interface DocumentName {
  readonly prefix: string
  readonly document: { readonly series: string; readonly number: number } | undefined
}

/**
 * The submitted XML and ANAF's ZIP of any submission in the history. Like
 * `useDocumentDownload`, the bytes are saved only if the session that asked
 * for them is still the one in place: a late answer is dropped, not written to disk.
 */
export const useEFacturaFiles = (client: EFacturaClient, name: DocumentName): EFacturaFilesModel => {
  const { epoch, ownsEpoch } = useAuth()
  const mutation = useMutation({
    mutationFn: async ({ submissionId, file }: { readonly submissionId: string; readonly file: EFacturaFile }) => {
      const started = epoch()
      const blob = await (file === "xml" ? client.submittedXml(submissionId) : client.anafResponse(submissionId))
      return { blob, started, file }
    },
    onSuccess: ({ blob, started, file }) => {
      if (name.document === undefined || !ownsEpoch(started)) return
      const prefix = file === "xml" ? `efactura-${name.prefix}` : `raspuns-anaf-${name.prefix}`
      downloadBlob(blob, documentFilename(prefix, name.document, file))
    },
  })
  const variables = mutation.isPending ? mutation.variables : undefined
  return {
    pendingKey: variables === undefined ? undefined : `${variables.submissionId}:${variables.file}`,
    failure: efacturaFailure(mutation.error),
    download: (submissionId, file) => { if (!mutation.isPending) mutation.mutate({ submissionId, file }) },
  }
}
