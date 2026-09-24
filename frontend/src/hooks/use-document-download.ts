import { useMutation } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { downloadBlob } from "../lib/browser-download.ts"

export interface DocumentDownloadInput {
  readonly key: string
  readonly label: string
  readonly pendingLabel: string
  readonly request: (csrfToken: string | undefined) => Promise<Blob>
  readonly filename: string | undefined
}

export interface DocumentDownloadAction {
  readonly key: string
  readonly label: string
  readonly pending: boolean
  readonly disabled: boolean
  readonly error: unknown
  readonly start: () => void
}

/**
 * A download whose side effect is tied to the session that asked for it.
 *
 * The bytes can arrive after the session they were requested in has ended — a
 * logout, an expiry, or another session started in the meantime — and saving a
 * private document to disk at that point would hand the previous session's
 * data to whoever is at the keyboard now. The epoch is read before the request
 * leaves and checked again in the callback, so a late answer is discarded
 * rather than written out. Nothing but the save is deferred: the request itself
 * is already refused by the server once the cookie stops being valid.
 */
export const useDocumentDownload = (input: DocumentDownloadInput): DocumentDownloadAction => {
  const { csrfToken, epoch, ownsEpoch } = useAuth()
  const mutation = useMutation({
    mutationFn: async () => {
      const started = epoch()
      return { blob: await input.request(csrfToken()), started }
    },
    onSuccess: ({ blob, started }) => {
      if (input.filename === undefined || !ownsEpoch(started)) return
      downloadBlob(blob, input.filename)
    },
  })
  return {
    key: input.key,
    label: mutation.isPending ? input.pendingLabel : input.label,
    pending: mutation.isPending,
    disabled: mutation.isPending || input.filename === undefined,
    error: mutation.error,
    start: () => { mutation.mutate() },
  }
}
