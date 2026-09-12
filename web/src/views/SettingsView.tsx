import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { IssuerBrand } from "../components/IssuerBrand.tsx"
import { DocumentSeriesCard } from "../components/DocumentSeriesCard.tsx"
import { Page } from "../components/Page.tsx"
import { SettingsHelpDialog } from "../components/SettingsHelpDialog.tsx"
import { Button } from "../components/ui/Button.tsx"
import { useIssuerSettings } from "../issuer-settings-hooks.ts"
import { romanianCuiPattern } from "../vat-defaults.ts"

export const SettingsView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const state = useIssuerSettings(notify)
  if (state.issuerQuery.isPending || state.catalogueQuery.isPending) return <Loading />
  if (state.issuerQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={state.issuerQuery.error} /></Page>
  if (state.catalogueQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={state.catalogueQuery.error} /></Page>
  const issuer = state.issuer
  return <Page title="Date firmă" eyebrow="Configurare emitent">
    <div className="settings-help-row"><SettingsHelpDialog /></div>
    <section className="card form-card">
      {state.save.error === null ? null : <ErrorAlert error={state.save.error} />}
      {state.vatInferenceError === null ? null : <ErrorAlert error={state.vatInferenceError} />}
      <form key={state.formKey} onSubmit={state.submit}>
        <fieldset className="issuer-settings-fields" disabled={state.save.pending}>
        <div className="form-grid two">
          <label>Denumire legală<input name="name" defaultValue={issuer?.name ?? ""} required /></label>
          <label>CUI / identificator fiscal<input name="fiscalIdentifier" defaultValue={state.fiscalIdentifier} pattern={romanianCuiPattern} maxLength={12} title="CUI românesc valid, cu sau fără prefixul RO" aria-describedby="issuer-cui-hint" onInput={(event) => { state.normalizeFiscalIdentifier(event.currentTarget) }} onBlur={(event) => { state.inferVat(event.currentTarget) }} required /></label>
          <label>Formă juridică<select name="legalForm" defaultValue={issuer?.legalForm ?? ""} required><option value="" disabled>Selectează forma juridică</option><option value="srl">SRL</option><option value="pfa">PFA</option></select></label>
          <label>Nr. Registrul Comerțului <span className="optional">necesar la emitere</span><input name="tradeRegistryNumber" defaultValue={issuer?.tradeRegistryNumber ?? ""} maxLength={32} placeholder="J2022000067070" /></label>
          <label>Țară<select name="countryCode" defaultValue="RO" required><option value="RO">România (RO)</option></select></label>
          <label>Localitate<input name="city" defaultValue={issuer?.address.city ?? ""} required /></label>
          <label className="span-two">Adresă<input name="street" defaultValue={issuer?.address.street ?? ""} required /></label>
          <label>Județ<input name="county" defaultValue={issuer?.address.county ?? ""} /></label>
          <label>Cod poștal<input name="postalCode" defaultValue={issuer?.address.postalCode ?? ""} /></label>
          <label>Capital social (RON) <span className="optional">necesar la emitere pentru SRL</span><input name="socialCapital" defaultValue={issuer?.socialCapital ?? ""} inputMode="decimal" maxLength={21} placeholder="200.00" /></label>
          <label>IBAN <span className="optional">opțional</span><input name="iban" defaultValue={issuer?.iban ?? ""} autoCapitalize="characters" spellCheck={false} /></label>
          <label className="span-two">Bancă <span className="optional">opțională</span><input name="bankName" defaultValue={issuer?.bankName ?? ""} /></label>
        </div>
        <p className="hint" id="issuer-cui-hint">CUI românesc valid, cu sau fără prefixul RO; cifra de control este verificată la salvare.</p>
        <hr />
        <fieldset className="branding-fields">
          <legend>Brand documente <span className="optional">opțional</span></legend>
          <label>Text de brand <span className="optional">maximum 80 de caractere</span><input name="brandingText" value={state.branding.text} aria-invalid={state.branding.error !== null} aria-describedby={state.branding.error === null ? undefined : "issuer-brand-text-error"} onChange={(event) => { state.branding.changeText(event.currentTarget.value) }} /></label>
          {state.branding.error === null ? null : <div id="issuer-brand-text-error"><ErrorAlert error={state.branding.error} /></div>}
          <label htmlFor="issuer-brand-image">Siglă PNG sau JPEG <span className="optional">maximum 256 KiB</span></label>
          <input id="issuer-brand-image" type="file" accept="image/png,image/jpeg,.jpg,.jpeg" aria-invalid={state.branding.imageError !== null} aria-describedby={state.branding.imageError === null ? "issuer-brand-image-hint" : "issuer-brand-image-hint issuer-brand-image-error"} onChange={(event) => { void state.branding.selectImage(event.currentTarget.files?.[0]); event.currentTarget.value = "" }} />
          <p className="hint" id="issuer-brand-image-hint">Maximum 2048 px pe axă și 4 megapixeli.</p>
          {state.branding.imageError === null ? null : <div id="issuer-brand-image-error"><ErrorAlert error={state.branding.imageError} /><Button type="button" variant="secondary" size="small" onClick={state.branding.discardRejectedImage}>Renunță la fișierul respins</Button></div>}
          {state.branding.pending ? <p className="status-note" role="status">Se validează imaginea…</p> : null}
          {state.branding.image === null ? null : <div className="branding-preview"><IssuerBrand branding={{ text: null, image: { pngBase64: state.branding.image.dataBase64, width: state.branding.image.width, height: state.branding.image.height } }} imageSrc={state.branding.image.previewUrl} /><Button type="button" variant="secondary" size="small" onClick={state.branding.removeImage}>Elimină sigla</Button></div>}
          {state.branding.text === "" && state.branding.image === null ? null : <Button type="button" variant="danger" size="small" onClick={state.branding.removeAll}>Elimină tot brandingul</Button>}
        </fieldset>
        <hr />
        <div className="form-grid two">
          <label>Monedă implicită<select name="defaultCurrency" defaultValue="RON" required><option value="RON">Leu românesc (RON)</option></select></label>
          <label>Termen de plată (zile)<input name="defaultPaymentTermDays" type="number" min="0" max="3650" defaultValue={issuer?.defaultPaymentTermDays ?? 15} required /></label>
          <label className="checkbox-label"><input name="vatRegistered" type="checkbox" checked={state.vatRegistered} onChange={(event) => { state.changeVatRegistration(event.currentTarget.checked) }} /> Plătitoare de TVA</label>
          <label>Schimbarea regimului se aplică de la<input name="taxEffectiveFrom" type="date" value={state.vatEffectiveFrom} onChange={(event) => { state.changeVatEffectiveFrom(event.currentTarget.value) }} required /></label>
        </div>
        <p className="hint" id="vat-hint">Prefixul RO al CUI-ului și regimul TVA ales trebuie să corespundă. Serverul validează concordanța și construiește calendarul cotelor.</p>
        <output name="vatStatus" className="status-note" aria-live="polite">{state.vatStatus}</output>
        {state.vatHistory.length === 0 ? null : <div><h3>Istoric regim TVA</h3><ul>{state.vatHistory.map((item) => <li key={`${item.effectiveFrom}-${item.effectiveTo ?? "prezent"}`}>{item.registered ? "Plătitor TVA" : "Neplătitor TVA"}: {item.rates}; {item.effectiveFrom} – {item.effectiveTo ?? "prezent"}</li>)}</ul></div>}
        {state.branding.imageError === null ? null : <p className="status-note warning" id="issuer-brand-save-warning">Sigla selectată nu este validă. Alege alt fișier sau renunță la fișierul respins înainte de salvare.</p>}
        <div className="form-actions"><Button type="submit" aria-describedby={state.branding.imageError === null ? undefined : "issuer-brand-save-warning"} disabled={state.save.pending || state.branding.pending}>{state.save.pending ? "Se salvează…" : "Salvează datele firmei"}</Button></div>
        </fieldset>
      </form>
    </section>
    <DocumentSeriesCard notify={notify} />
  </Page>
}
