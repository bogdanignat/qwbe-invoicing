import { ErrorAlert } from "./AsyncState.tsx"
import type { ProformaIssuanceState } from "../proforma-hooks.ts"
import { Button } from "./ui/Button.tsx"
import { ButtonLink } from "./ui/ButtonLink.tsx"

export const ProformaIssueControl = ({ state }: { readonly state: ProformaIssuanceState }) => {
  if (!state.visible) return null
  return <div aria-labelledby="proforma-issuance-title">
    <h3 id="proforma-issuance-title">Emitere proformă</h3>
    {state.error === null ? null : <ErrorAlert error={state.error} />}
    {state.series.length === 0
      ? <><Button variant="secondary" fullWidth disabled aria-describedby="proforma-issue-reason">Emite proforma</Button><p className="hint left" id="proforma-issue-reason" role="status">{state.disabledReason}</p><ButtonLink variant="secondary" fullWidth href="/settings">Configurează seria în setări</ButtonLink></>
      : <><label>Serie proformă<select value={state.selectedSeries} disabled={state.pending} onChange={(event) => { const { value } = event.currentTarget; state.selectSeries(value) }}>{state.series.map((series) => <option key={series} value={series}>{series}</option>)}</select></label><Button variant="secondary" fullWidth disabled={!state.canIssue} aria-describedby={state.disabledReason === null ? undefined : "proforma-issue-reason"} onClick={(event) => { if (event.currentTarget.form?.reportValidity() !== false) state.issue() }}>{state.pending ? "Se emite…" : "Emite proforma"}</Button>{state.disabledReason === null ? null : <p className="hint left" id="proforma-issue-reason" role="status">{state.disabledReason}</p>}<p className="hint">Emite direct documentul comercial nefiscal; salvarea prealabilă ca draft este opțională.</p></>}
  </div>
}
