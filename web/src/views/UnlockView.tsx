import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { ErrorAlert } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"

export const UnlockView = ({ onUnlock }: { readonly onUnlock: (token: string) => Promise<void> }) => {
  const tokenInput = useRef<HTMLInputElement>(null)
  const unlock = useMutation({ mutationFn: onUnlock, gcTime: 0 })
  useEffect(() => { tokenInput.current?.focus() }, [])
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    unlock.mutate(formField(event.currentTarget, "token"))
  }
  return <Page title="Bine ai revenit" eyebrow="QWBE Invoicing">
    <section className="unlock-card">
      <div className="unlock-icon" aria-hidden="true">⌁</div>
      <p>Introdu tokenul API local pentru această sesiune. Nu îl salvăm în browser, URL sau storage.</p>
      {unlock.error === null ? null : <ErrorAlert error={unlock.error} />}
      <form onSubmit={submit}>
        <label htmlFor="api-token">Token API</label>
        <input ref={tokenInput} id="api-token" name="token" type="password" autoComplete="off" required />
        <button className="button primary" type="submit" disabled={unlock.isPending}>{unlock.isPending ? "Se verifică…" : "Deblochează aplicația"}</button>
      </form>
    </section>
  </Page>
}
