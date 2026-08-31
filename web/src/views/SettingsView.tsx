import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { runUiEffect } from "../api.ts"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"
import { today } from "../format.ts"
import { invoicingClient } from "../invoicing-client.ts"

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
    saveIssuer.mutate({
      legalName: formField(form, "legalName"), taxIdentifier: formField(form, "taxIdentifier"),
      address: { countryCode: formField(form, "countryCode"), city: formField(form, "city"), street: formField(form, "street"), ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }) },
      defaultCurrency: formField(form, "defaultCurrency"), defaultPaymentTermDays: Number(formField(form, "defaultPaymentTermDays")),
      defaultSeries: formField(form, "defaultSeries"),
      taxConfigurations: [{ code: formField(form, "taxCode"), category: "standard", rate: formField(form, "taxRate"), effectiveFrom: formField(form, "taxEffectiveFrom") }],
    })
  }
  if (issuerQuery.isPending) return <Loading />
  if (issuerQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={issuerQuery.error} /></Page>
  const issuer = issuerQuery.data ?? undefined
  const tax = issuer?.taxConfigurations[0]
  return <Page title="Date firmă" eyebrow="Configurare emitent">
    <section className="card form-card">
      {saveIssuer.error === null ? null : <ErrorAlert error={saveIssuer.error} />}
      <form key={issuer?.organizationId ?? "new"} onSubmit={submit}>
        <div className="form-grid two">
          <label>Denumire legală<input name="legalName" defaultValue={issuer?.legalName ?? ""} required /></label>
          <label>CUI / identificator fiscal<input name="taxIdentifier" defaultValue={issuer?.taxIdentifier ?? ""} required /></label>
          <label>Țară<input name="countryCode" defaultValue={issuer?.address.countryCode ?? "RO"} maxLength={2} required /></label>
          <label>Localitate<input name="city" defaultValue={issuer?.address.city ?? ""} required /></label>
          <label className="span-two">Adresă<input name="street" defaultValue={issuer?.address.street ?? ""} required /></label>
          <label>Județ<input name="county" defaultValue={issuer?.address.county ?? ""} /></label>
          <label>Cod poștal<input name="postalCode" defaultValue={issuer?.address.postalCode ?? ""} /></label>
        </div>
        <hr />
        <div className="form-grid two">
          <label>Monedă implicită<input name="defaultCurrency" defaultValue={issuer?.defaultCurrency ?? "RON"} required /></label>
          <label>Termen de plată (zile)<input name="defaultPaymentTermDays" type="number" min="0" defaultValue={issuer?.defaultPaymentTermDays ?? 15} required /></label>
          <label>Serie implicită<input name="defaultSeries" defaultValue={issuer?.defaultSeries ?? "QWBE"} required /></label>
          <label>Cod TVA<input name="taxCode" defaultValue={tax?.code ?? "RO_STANDARD"} required /></label>
          <label>Cotă TVA (%)<input name="taxRate" inputMode="decimal" defaultValue={tax?.rate ?? "21.00"} required /></label>
          <label>TVA valabil de la<input name="taxEffectiveFrom" type="date" defaultValue={tax?.effectiveFrom ?? today()} required /></label>
        </div>
        <div className="form-actions"><button className="button primary" type="submit" disabled={saveIssuer.isPending}>{saveIssuer.isPending ? "Se salvează…" : "Salvează datele firmei"}</button></div>
      </form>
    </section>
  </Page>
}
