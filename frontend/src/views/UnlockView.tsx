"use client"

import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Button } from "../components/Button.tsx"
import { Page } from "../components/Page.tsx"
import { SessionRecovery } from "../components/SessionRecovery.tsx"
import { Shell } from "../components/Shell.tsx"
import { useTokenInputFocus } from "../hooks/use-token-input-focus.ts"
import { useUnlockViewModel } from "../hooks/use-unlock-view-model.ts"

export const UnlockView = () => {
  const model = useUnlockViewModel()
  const inputRef = useTokenInputFocus(model.status === "locked", model.pending)
  if (model.status === "checking" || model.status === "authenticated") {
    return <Shell unlocked={false}><Loading label="Verific sesiunea…" /></Shell>
  }
  if (model.status === "restore-error") {
    return <Shell unlocked={false}><SessionRecovery error={model.error} onRetry={model.retryRestore} /></Shell>
  }
  return <Shell unlocked={false}><Page title="Bine ai revenit" eyebrow="QWBE Invoicing">
    <section className="unlock-card">
      <div className="unlock-icon" aria-hidden="true">⌁</div>
      <p>Introdu tokenul API local. Browserul va păstra numai sesiunea opacă HttpOnly; tokenul nu este salvat în JavaScript, URL sau storage.</p>
      {model.error === undefined ? null : <ErrorAlert error={model.error} />}
      <form action={model.submit}>
        <label htmlFor="api-token">Token API</label>
        <input ref={inputRef} id="api-token" name="token" type="password" autoComplete="off" required />
        <Button type="submit" disabled={model.pending}>{model.pending ? "Se verifică…" : "Deblochează aplicația"}</Button>
      </form>
    </section>
  </Page></Shell>
}
