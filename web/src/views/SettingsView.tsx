import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { runUiEffect } from "../api.ts"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { DocumentSeriesCard } from "../components/DocumentSeriesCard.tsx"
import { Page } from "../components/Page.tsx"
import { SettingsHelpDialog } from "../components/SettingsHelpDialog.tsx"
import { Button } from "../components/ui/Button.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"
import { today } from "../format.ts"
import { normalizeRomanianCui, romanianCuiPattern } from "../identifiers.ts"
import { invoicingClient, type VatRegime } from "../invoicing-client.ts"

// The VAT regime is chosen from the server's catalogue and proposed by the server from the CUI;
// the schedule (closing the old period, opening the new one) is computed by the server from
// `vatChange`. This view holds no fiscal rule of its own.
export const SettingsView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const queryClient = useQueryClient()
  const issuerQuery = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const regimesQuery = useQuery({ queryKey: ["vat-regimes"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listVatRegimes(), signal) })
  const [chosenRegime, setChosenRegime] = useState<string | undefined>(undefined)
  const [effectiveFrom, setEffectiveFrom] = useState<string | undefined>(undefined)
  const [regimeNote, setRegimeNote] = useState<string | undefined>(undefined)
  const manual = useRef(false)
  const inferRegime = useMutation({
    mutationFn: (inference: { readonly countryCode: string; readonly fiscalIdentifier: string }) => runUiEffect(invoicingClient.listVatRegimes(inference)),
    onSuccess: ({ inferred }) => {
      if (inferred === null || manual.current) return
      setChosenRegime(inferred.code)
      setEffectiveFrom((current) => current ?? today())
      setRegimeNote(inferred.registered
        ? "Prefix RO detectat: firma este propusă ca plătitoare de TVA."
        : "CUI fără prefix RO: firma este propusă ca neplătitoare de TVA, cu cotă 0%.")
    },
  })
  const saveIssuer = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) => runUiEffect(invoicingClient.saveIssuer(body)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["issuer"] }); notify("Datele firmei au fost salvate.") },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const county = formField(form, "county")
    const postalCode = formField(form, "postalCode")
    const regime = regimes.find((candidate) => candidate.code === formField(form, "vatRegime"))
    if (regime === undefined) return
    saveIssuer.mutate({
      name: formField(form, "name"), fiscalIdentifier: formField(form, "fiscalIdentifier"),
      address: { countryCode: "RO", city: formField(form, "city"), street: formField(form, "street"), ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }) },
      defaultCurrency: "RON", defaultPaymentTermDays: Number(formField(form, "defaultPaymentTermDays")),
      vatChange: { code: regime.code, rate: regime.rate, effectiveFrom: formField(form, "taxEffectiveFrom") },
    })
  }
  if (issuerQuery.isPending || regimesQuery.isPending) return <Loading />
  if (issuerQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={issuerQuery.error} /></Page>
  if (regimesQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={regimesQuery.error} /></Page>
  const issuer = issuerQuery.data ?? undefined
  const regimes: ReadonlyArray<VatRegime> = regimesQuery.data.regimes
  const currentCode = chosenRegime ?? issuer?.currentVat?.code ?? regimes[0]?.code ?? ""
  const currentRegime = regimes.find((candidate) => candidate.code === currentCode)
  const effectiveFromValue = effectiveFrom ?? issuer?.currentVat?.effectiveFrom ?? today()
  return <Page title="Date firmă" eyebrow="Configurare emitent">
    <div className="settings-help-row"><SettingsHelpDialog /></div>
    <section className="card form-card">
      {saveIssuer.error === null ? null : <ErrorAlert error={saveIssuer.error} />}
      <form key={issuer?.organizationId ?? "new"} onSubmit={submit}>
        <div className="form-grid two">
          <label>Denumire legală<input name="name" defaultValue={issuer?.name ?? ""} required /></label>
          <label>CUI / identificator fiscal<input name="fiscalIdentifier" defaultValue={issuer?.fiscalIdentifier ?? ""} pattern={romanianCuiPattern} maxLength={12} title="CUI românesc valid, cu sau fără prefixul RO" aria-describedby="issuer-cui-hint" onInput={(event) => { event.currentTarget.value = normalizeRomanianCui(event.currentTarget.value) }} onBlur={(event) => { inferRegime.mutate({ countryCode: "RO", fiscalIdentifier: event.currentTarget.value }) }} required /></label>
          <label>Țară<select name="countryCode" defaultValue="RO" required><option value="RO">România (RO)</option></select></label>
          <label>Localitate<input name="city" defaultValue={issuer?.address.city ?? ""} required /></label>
          <label className="span-two">Adresă<input name="street" defaultValue={issuer?.address.street ?? ""} required /></label>
          <label>Județ<input name="county" defaultValue={issuer?.address.county ?? ""} /></label>
          <label>Cod poștal<input name="postalCode" defaultValue={issuer?.address.postalCode ?? ""} /></label>
        </div>
        <p className="hint" id="issuer-cui-hint">CUI românesc valid, cu sau fără prefixul RO; cifra de control este verificată la salvare.</p>
        <hr />
        <div className="form-grid two">
          <label>Monedă implicită<select name="defaultCurrency" defaultValue="RON" required><option value="RON">Leu românesc (RON)</option></select></label>
          <label>Termen de plată (zile)<input name="defaultPaymentTermDays" type="number" min="0" max="3650" defaultValue={issuer?.defaultPaymentTermDays ?? 15} required /></label>
          <label>Regim TVA<select name="vatRegime" value={currentCode} aria-describedby="vat-hint" onChange={(event) => { manual.current = true; setChosenRegime(event.currentTarget.value); setEffectiveFrom(today()); setRegimeNote("Regimul a fost ales explicit.") }} required>{regimes.map((regime) => <option key={regime.code} value={regime.code}>{regime.label}</option>)}</select></label>
          <label>Regimul se aplică de la<input name="taxEffectiveFrom" type="date" value={effectiveFromValue} onChange={(event) => { setEffectiveFrom(event.currentTarget.value) }} required /></label>
        </div>
        <p className="hint" id="vat-hint">Prefixul RO al CUI-ului și regimul TVA trebuie să corespundă; serverul refuză salvarea cât timp sunt în contradicție.{currentRegime === undefined ? "" : ` Cotă aplicată: ${currentRegime.rate}%.`}</p>
        <output name="vatStatus" className="status-note" aria-live="polite">{regimeNote ?? (currentRegime?.registered === false ? "Firma este configurată ca neplătitoare de TVA, cu cotă 0%." : "Firma este configurată ca plătitoare de TVA.")}</output>
        <div className="form-actions"><Button type="submit" disabled={saveIssuer.isPending}>{saveIssuer.isPending ? "Se salvează…" : "Salvează datele firmei"}</Button></div>
      </form>
    </section>
    <DocumentSeriesCard notify={notify} />
  </Page>
}
