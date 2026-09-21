import type { useIssuerSettings } from "../../hooks/issuer-settings-hooks.ts"

export const IssuerVatFields = ({ state }: { readonly state: ReturnType<typeof useIssuerSettings> }) => <>
  <div className="form-grid two">
    <label>Monedă implicită<select name="defaultCurrency" defaultValue="RON" required><option value="RON">Leu românesc (RON)</option></select></label>
    <label>Termen de plată (zile)<input name="defaultPaymentTermDays" type="number" min="0" max="3650" defaultValue={state.issuer?.defaultPaymentTermDays ?? 15} required /></label>
    <label className="checkbox-label"><input name="vatRegistered" type="checkbox" checked={state.vatRegistered} onChange={(event) => { state.changeVatRegistration(event.currentTarget.checked) }} /> Plătitoare de TVA</label>
    <label>Schimbarea regimului se aplică de la<input name="taxEffectiveFrom" type="date" value={state.vatEffectiveFrom} onChange={(event) => { state.changeVatEffectiveFrom(event.currentTarget.value) }} required /></label>
  </div>
  {state.vatRegistered ? null : <p className="hint">Informațiile fiscale pentru regimul art. 310 se completează automat. Alte regimuri de scutire nu sunt încă suportate.</p>}
  <p className="hint" id="vat-hint">Regimul TVA este ales explicit și independent de forma în care introduci CUI-ul. Pentru o firmă nouă, temeiul art. 310 nu este selectat automat.</p>
  <output name="vatStatus" className="status-note" aria-live="polite">{state.vatStatus}</output>
  {state.vatHistory.length === 0 ? null : <div><h3>Istoric regim TVA</h3><ul>{state.vatHistory.map((item) => <li key={`${item.effectiveFrom}-${item.effectiveTo ?? "prezent"}`}>{item.registered ? "Plătitor TVA" : "Scutit TVA — art. 310"}: {item.rates}; {item.effectiveFrom} – {item.effectiveTo ?? "prezent"}</li>)}</ul></div>}
</>
