import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { IssuerBrand } from "../components/IssuerBrand.tsx"
import { DocumentSeriesCard } from "../components/DocumentSeriesCard.tsx"
import { Page } from "../components/Page.tsx"
import { SettingsHelpDialog } from "../components/SettingsHelpDialog.tsx"
import { Button } from "../components/ui/Button.tsx"
import { today } from "../format.ts"
import { useIssuerSettings } from "../issuer-settings-hooks.ts"
import { romanianCuiPattern } from "../vat-defaults.ts"

export const SettingsView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const state = useIssuerSettings(notify)
  if (state.issuerQuery.isPending) return <Loading />
  if (state.issuerQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={state.issuerQuery.error} /></Page>
  const issuer = state.issuer
  return <Page title="Date firmă" eyebrow="Configurare emitent">
    <div className="settings-help-row"><SettingsHelpDialog /></div>
    <section className="card form-card">
      {state.save.error === null ? null : <ErrorAlert error={state.save.error} />}
      {state.branding.error === null ? null : <ErrorAlert error={state.branding.error} />}
      <form key={state.formKey} onSubmit={state.submit}>
        <fieldset className="issuer-settings-fields" disabled={state.save.pending}>
        <div className="form-grid two">
          <label>Denumire legală<input name="name" defaultValue={issuer?.name ?? ""} required /></label>
          <label>CUI / identificator fiscal<input name="fiscalIdentifier" defaultValue={state.fiscalIdentifier} pattern={romanianCuiPattern} maxLength={12} title="CUI românesc valid, cu sau fără prefixul RO" aria-describedby="issuer-cui-hint vat-mismatch" onInput={(event) => { state.normalizeFiscalIdentifier(event.currentTarget) }} onBlur={(event) => { state.inferVat(event.currentTarget) }} required /></label>
          <label>Țară<select name="countryCode" defaultValue="RO" required><option value="RO">România (RO)</option></select></label>
          <label>Localitate<input name="city" defaultValue={issuer?.address.city ?? ""} required /></label>
          <label className="span-two">Adresă<input name="street" defaultValue={issuer?.address.street ?? ""} required /></label>
          <label>Județ<input name="county" defaultValue={issuer?.address.county ?? ""} /></label>
          <label>Cod poștal<input name="postalCode" defaultValue={issuer?.address.postalCode ?? ""} /></label>
        </div>
        <p className="hint" id="issuer-cui-hint">CUI românesc valid, cu sau fără prefixul RO; cifra de control este verificată la salvare.</p>
        <hr />
        <fieldset className="branding-fields">
          <legend>Brand documente <span className="optional">opțional</span></legend>
          <label>Text de brand <span className="optional">maximum 80 de caractere</span><input name="brandingText" value={state.branding.text} onChange={(event) => { state.branding.changeText(event.currentTarget.value) }} /></label>
          <label htmlFor="issuer-brand-image">Siglă PNG sau JPEG <span className="optional">maximum 256 KiB</span></label>
          <input id="issuer-brand-image" type="file" accept="image/png,image/jpeg,.jpg,.jpeg" onChange={(event) => { void state.branding.selectImage(event.currentTarget.files?.[0]); event.currentTarget.value = "" }} />
          {state.branding.pending ? <p className="status-note" role="status">Se validează imaginea…</p> : null}
          {state.branding.image === null ? null : <div className="branding-preview"><IssuerBrand branding={{ text: null, image: { pngBase64: state.branding.image.dataBase64, width: state.branding.image.width, height: state.branding.image.height } }} imageSrc={state.branding.image.previewUrl} /><Button type="button" variant="secondary" size="small" onClick={state.branding.removeImage}>Elimină sigla</Button></div>}
          {state.branding.text === "" && state.branding.image === null ? null : <Button type="button" variant="danger" size="small" onClick={state.branding.removeAll}>Elimină tot brandingul</Button>}
        </fieldset>
        <hr />
        <div className="form-grid two">
          <label>Monedă implicită<select name="defaultCurrency" defaultValue="RON" required><option value="RON">Leu românesc (RON)</option></select></label>
          <label>Termen de plată (zile)<input name="defaultPaymentTermDays" type="number" min="0" max="3650" defaultValue={issuer?.defaultPaymentTermDays ?? 15} required /></label>
          <label className="checkbox-label"><input name="vatRegistered" type="checkbox" defaultChecked={state.vatRegistered} data-manual={issuer === undefined ? undefined : "true"} onChange={(event) => { state.changeVatRegistration(event.currentTarget) }} /> Plătitoare de TVA</label>
          <label>Cod TVA<input name="vatRateCode" defaultValue={state.configuredVat.code} readOnly={!state.vatRegistered} aria-describedby="vat-hint" onInput={(event) => { state.markVatEffectiveToday(event.currentTarget) }} required /></label>
          <label>Cotă TVA (%)<input name="vatRate" inputMode="decimal" defaultValue={state.configuredVat.rate} readOnly={!state.vatRegistered} aria-describedby="vat-hint" onInput={(event) => { state.markVatEffectiveToday(event.currentTarget) }} required /></label>
          <label>Noua configurație TVA valabilă de la<input name="taxEffectiveFrom" type="date" defaultValue={state.tax?.effectiveFrom ?? today()} required /></label>
        </div>
        <p className="hint" id="vat-hint">Prefixul RO și bifa „Plătitoare de TVA” trebuie să corespundă. Configurația nu poate fi salvată cât timp sunt în contradicție.</p>
        <p className="status-note warning" id="vat-mismatch" role="status" aria-live="polite" hidden={state.vatMismatchMessage === undefined}>{state.vatMismatchMessage}</p>
        <output name="vatStatus" className="sr-only" aria-live="polite">{state.vatRegistered ? "Firma este configurată ca plătitoare de TVA." : "Firma este configurată ca neplătitoare de TVA, cu cotă 0%."}</output>
        <div className="form-actions"><Button type="submit" disabled={state.save.pending || state.branding.pending}>{state.save.pending ? "Se salvează…" : "Salvează datele firmei"}</Button></div>
        </fieldset>
      </form>
    </section>
    <DocumentSeriesCard notify={notify} />
  </Page>
}
