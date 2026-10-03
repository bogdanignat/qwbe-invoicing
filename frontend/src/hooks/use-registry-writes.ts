"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { registryWriteOutcome } from "../lib/registry-write-outcome.ts"
import type { RegistryWrite } from "../lib/registry-feedback.ts"

/**
 * One master-data write, from the CSRF token to the notice it leaves behind.
 *
 * Master data is not a fiscal document: there is no idempotency key, no
 * journal and nothing to replay. A write either answered — the record is in the
 * registry the invalidation refreshes — or it did not, and the user repeats it;
 * a duplicate is deletable, unlike an issued number. So the wiring here is
 * deliberately the plain one, and `useProformaSave` stays the only place with a
 * recovery controller.
 *
 * The session is still checked on both ends: no token means the request never
 * leaves, and an answer that arrives after a logout (or after another session
 * took over) leaves neither a notice, nor a refetch, nor an error behind —
 * `registryWriteOutcome` filters the rejection as well as the success.
 */
export interface RegistryWriteRequest {
  readonly write: RegistryWrite
  readonly run: (csrfToken: string) => Promise<unknown>
  /** Runs only when the answer still belongs to this session: closes the editor, clears the form. */
  readonly onDone?: () => void
}

export interface RegistryWrites {
  readonly pending: boolean
  readonly error: unknown
  readonly notice: string | undefined
  readonly submit: (request: RegistryWriteRequest) => void
  readonly dismissNotice: () => void
}

export const SESSION_CLOSED = "Sesiunea nu mai este deschisă. Deblochează din nou ca să salvezi."

export const useRegistryWrites = (
  queryKey: ReadonlyArray<string>,
  notice: (write: RegistryWrite) => string,
): RegistryWrites => {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | undefined>(undefined)
  const mutation = useMutation({
    mutationFn: async (request: RegistryWriteRequest): Promise<RegistryWriteRequest | undefined> => {
      const csrfToken = auth.csrfToken()
      if (csrfToken === undefined) throw new Error(SESSION_CLOSED)
      const epoch = auth.epoch()
      // Both ends of the answer are filtered by the epoch, not only the
      // successful one: `registry-write-outcome.ts` holds the rule and its test.
      return await registryWriteOutcome(request, () => request.run(csrfToken), () => auth.ownsEpoch(epoch))
    },
    onSuccess: (request) => {
      if (request === undefined) return
      setMessage(notice(request.write))
      void queryClient.invalidateQueries({ queryKey })
      request.onDone?.()
    },
  })
  return {
    pending: mutation.isPending,
    error: mutation.error,
    notice: message,
    submit: (request) => {
      setMessage(undefined)
      mutation.mutate(request)
    },
    dismissNotice: () => { setMessage(undefined) },
  }
}
