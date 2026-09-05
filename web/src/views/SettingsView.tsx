import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { runUiEffect } from "../api.ts"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { DocumentSeriesCard } from "../components/DocumentSeriesCard.tsx"
import { Page } from "../components/Page.tsx"
import { SettingsHelpDialog } from "../components/SettingsHelpDialog.tsx"
import { Button } from "../components/ui/Button.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"
import { today } from "../format.ts"
import { invoicingClient } from "../invoicing-client.ts"
import { inferRomanianVatDefaults, nearestConfiguredVat, isNonVat, normalizeRomanianCui, resolveVatValues, romanianCuiPattern, updateVatTimeline, vatRegistrationMismatch, vatTimelineMismatch, type VatValues } from "../vat-defaults.ts"

const updateVatMismatch = (form: HTMLFormElement, registered: boolean): void => {
  const message = vatRegistrationMismatch(formField(form, "countryCode"), formField(form, "fiscalIdentifier"), registered)
  const fiscalIdentifier = form.elements.namedItem("fiscalIdentifier")
  if (fiscalIdentifier instanceof HTMLInputElement) fiscalIdentifier.setCustomValidity(message ?? "")
  const mismatch = form.querySelector<HTMLElement>("#vat-mismatch")
  if (mismatch !== null) {
    mismatch.hidden = message === undefined
    if (message !== undefined) mismatch.textContent = message
  }
}

const updateVatFields = (form: HTMLFormElement, registered: boolean, message: string): void => {
  const code = form.elements.namedItem("vatRateCode")
  const rate = form.elements.namedItem("vatRate")
  const status = form.elements.namedItem("vatStatus")
  if (!(code instanceof HTMLInputElement) || !(rate instanceof HTMLInputElement)) return
  const resolved = resolveVatValues(registered, { code: code.value.trim(), rate: rate.value.trim() })
  code.value = resolved.code
  rate.value = resolved.rate
  code.readOnly = !registered
  rate.readOnly = !registered
  if (status instanceof HTMLOutputElement) status.value = message
  updateVatMismatch(form, registered)
}

const applyInferredVatDefaults = (input: HTMLInputElement): void => {
  const form = input.form
  const registration = form?.elements.namedItem("vatRegistered")
  if (form === null || !(registration instanceof HTMLInputElement)) return
  const inferred = inferRomanianVatDefaults(formField(form, "countryCode"), formField(form, "fiscalIdentifier"))
  if (registration.dataset.manual === "true") {
    updateVatMismatch(form, registration.checked)
    return
  }
  if (inferred === undefined) return
  registration.checked = inferred.registered
  updateVatFields(form, inferred.registered, inferred.registered
    ? "Prefix RO detectat: firma este propusă ca plătitoare de TVA."
    : "CUI fără prefix RO: firma este propusă ca neplătitoare de TVA, cu cotă 0%.")
}

const markVatChangeEffectiveToday = (input: HTMLInputElement): void => {
  const effectiveFrom = input.form?.elements.namedItem("taxEffectiveFrom")
  if (effectiveFrom instanceof HTMLInputElement) effectiveFrom.value = today()
}

const applyExplicitVatRegistration = (registration: HTMLInputElement): void => {
  const form = registration.form
  if (form === null) return
  registration.dataset.manual = "true"
  markVatChangeEffectiveToday(registration)
  updateVatFields(form, registration.checked, registration.checked
    ? "Firma a fost marcată explicit ca plătitoare de TVA."
    : "Firma a fost marcată explicit ca neplătitoare de TVA, cu cotă 0%.")
}

export const SettingsView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const queryClient = useQueryClient()
  const issuerQuery = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const saveIssuer = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) => runUiEffect(invoicingClient.saveIssuer(body)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["issuer"] }); notify("Datele firmei au fost salvate.") },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const county = formField(form, "county")
    const postalCode = formField(form, "postalCode")
    const countryCode = "RO"
    const fiscalIdentifier = formField(form, "fiscalIdentifier")
    const registration = form.elements.namedItem("vatRegistered")
    const registered = registration instanceof HTMLInputElement && registration.checked
    const vat = resolveVatValues(registered, {
      code: formField(form, "vatRateCode"),
      rate: formField(form, "vatRate"),
    })
    const existingConfigurations = issuerQuery.data?.vatConfigurations ?? []
    const vatConfigurations = updateVatTimeline(
      existingConfigurations,
      nearestConfiguredVat(existingConfigurations, today()),
      vat,
      formField(form, "taxEffectiveFrom"),
    )
    const mismatch = vatTimelineMismatch(countryCode, fiscalIdentifier, vatConfigurations)
    const taxIdentifierInput = form.elements.namedItem("fiscalIdentifier")
    if (taxIdentifierInput instanceof HTMLInputElement) taxIdentifierInput.setCustomValidity(mismatch ?? "")
    if (mismatch !== undefined) {
      const warning = form.querySelector<HTMLElement>("#vat-mismatch")
      if (warning !== null) { warning.hidden = false; warning.textContent = mismatch }
      if (taxIdentifierInput instanceof HTMLInputElement) taxIdentifierInput.reportValidity()
      return
    }
    saveIssuer.mutate({
      name: formField(form, "name"), fiscalIdentifier,
      address: { countryCode, city: formField(form, "city"), street: formField(form, "street"), ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }) },
      defaultCurrency: "RON", defaultPaymentTermDays: Number(formField(form, "defaultPaymentTermDays")),
      vatConfigurations,
    })
  }
  if (issuerQuery.isPending) return <Loading />
  if (issuerQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={issuerQuery.error} /></Page>
  const issuer = issuerQuery.data ?? undefined
  const tax = nearestConfiguredVat(issuer?.vatConfigurations ?? [], today())
  const countryCode = "RO"
  const fiscalIdentifier = issuer?.fiscalIdentifier ?? ""
  const configuredVat: VatValues = { code: tax?.code ?? "RO_STANDARD", rate: tax?.rate ?? "21.00" }
  const inferredVat = inferRomanianVatDefaults(countryCode, fiscalIdentifier)
  const vatRegistered = issuer === undefined ? (inferredVat?.registered ?? true) : !isNonVat(configuredVat)
  const displayedVat = configuredVat
  const vatMismatchMessage = issuer === undefined
    ? vatRegistrationMismatch(countryCode, fiscalIdentifier, vatRegistered)
    : vatTimelineMismatch(countryCode, fiscalIdentifier, issuer.vatConfigurations)
  return <Page title="Date firmă" eyebrow="Configurare emitent">
    <div className="settings-help-row"><SettingsHelpDialog /></div>
    <section className="card form-card">
      {saveIssuer.error === null ? null : <ErrorAlert error={saveIssuer.error} />}
      <form key={issuer?.organizationId ?? "new"} onSubmit={submit}>
        <div className="form-grid two">
          <label>Denumire legală<input name="name" defaultValue={issuer?.name ?? ""} required /></label>
          <label>CUI / identificator fiscal<input name="fiscalIdentifier" defaultValue={fiscalIdentifier} pattern={romanianCuiPattern} maxLength={12} title="CUI românesc valid, cu sau fără prefixul RO" aria-describedby="issuer-cui-hint vat-mismatch" onInput={(event) => { event.currentTarget.setCustomValidity(""); event.currentTarget.value = normalizeRomanianCui(event.currentTarget.value) }} onBlur={(event) => { applyInferredVatDefaults(event.currentTarget) }} required /></label>
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
          <label className="checkbox-label"><input name="vatRegistered" type="checkbox" defaultChecked={vatRegistered} data-manual={issuer === undefined ? undefined : "true"} onChange={(event) => { applyExplicitVatRegistration(event.currentTarget) }} /> Plătitoare de TVA</label>
          <label>Cod TVA<input name="vatRateCode" defaultValue={displayedVat.code} readOnly={!vatRegistered} aria-describedby="vat-hint" onInput={(event) => { markVatChangeEffectiveToday(event.currentTarget) }} required /></label>
          <label>Cotă TVA (%)<input name="vatRate" inputMode="decimal" defaultValue={displayedVat.rate} readOnly={!vatRegistered} aria-describedby="vat-hint" onInput={(event) => { markVatChangeEffectiveToday(event.currentTarget) }} required /></label>
          <label>Noua configurație TVA valabilă de la<input name="taxEffectiveFrom" type="date" defaultValue={tax?.effectiveFrom ?? today()} required /></label>
        </div>
        <p className="hint" id="vat-hint">Prefixul RO și bifa „Plătitoare de TVA” trebuie să corespundă. Configurația nu poate fi salvată cât timp sunt în contradicție.</p>
        <p className="status-note warning" id="vat-mismatch" role="status" aria-live="polite" hidden={vatMismatchMessage === undefined}>{vatMismatchMessage}</p>
        <output name="vatStatus" className="sr-only" aria-live="polite">{vatRegistered ? "Firma este configurată ca plătitoare de TVA." : "Firma este configurată ca neplătitoare de TVA, cu cotă 0%."}</output>
        <div className="form-actions"><Button type="submit" disabled={saveIssuer.isPending}>{saveIssuer.isPending ? "Se salvează…" : "Salvează datele firmei"}</Button></div>
      </form>
    </section>
    <DocumentSeriesCard notify={notify} />
  </Page>
}
