import { ErrorAlert } from "./AsyncState.tsx"
import { Button } from "./Button.tsx"
import { Page } from "./Page.tsx"

export const SessionRecovery = ({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) =>
  <Page title="Sesiunea nu a putut fi verificată" eyebrow="QWBE Invoicing">
    <section className="unlock-card">
      <ErrorAlert error={error} />
      <p>Conținutul privat rămâne ascuns până când serverul confirmă sesiunea.</p>
      <Button type="button" onClick={onRetry}>Reîncearcă verificarea</Button>
    </section>
  </Page>
