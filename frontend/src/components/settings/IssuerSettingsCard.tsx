"use client"

import { Button } from "../Button.tsx"
import { ErrorAlert } from "../AsyncState.tsx"
import { IssuerAddressFields } from "./IssuerAddressFields.tsx"
import { IssuerBrandingFields } from "./IssuerBrandingFields.tsx"
import { IssuerIdentityFields } from "./IssuerIdentityFields.tsx"
import { IssuerVatFields } from "./IssuerVatFields.tsx"
import { IssuerVatHistory } from "./IssuerVatHistory.tsx"
import { useRefusedFieldFocus } from "../../hooks/use-refused-field-focus.ts"
import { ISSUER_FORM, registryFieldAria } from "../../lib/registry-fields.ts"
import type { IssuerSettingsModel } from "../../hooks/use-issuer-settings.ts"

/**
 * The issuer profile as one form: identity, address, brand, VAT, and the
 * read-only history under it.
 *
 * The sections are rendered in the order the model validates them, so the field
 * a refusal names is always the first wrong one reading down the screen — the
 * focus move `useRefusedFieldFocus` performs then lands where the eye already is.
 */
export const IssuerSettingsCard = ({ model }: { readonly model: IssuerSettingsModel }) => {
  const { form, issue, pending } = model
  useRefusedFieldFocus(ISSUER_FORM, issue?.field)
  const aria = registryFieldAria(ISSUER_FORM, issue?.field)
  return <section className="card form-card" aria-labelledby="issuer-settings-title">
    <div className="section-heading"><div>
      <h2 id="issuer-settings-title">Date firmă</h2>
      <p>Datele sunt copiate pe fiecare document în momentul emiterii.</p>
    </div></div>
    {model.notice === undefined ? null : <p className="status-note" role="status">{model.notice}</p>}
    {model.error === null || model.error === undefined ? null : <ErrorAlert error={model.error} />}
    <form onSubmit={(event) => { event.preventDefault(); model.submit() }}>
      <IssuerIdentityFields form={form} disabled={pending} issue={issue} aria={aria}
        onChange={model.change} onIdentifierChange={model.changeIdentifier} />
      <hr />
      <IssuerAddressFields form={form} disabled={pending} issue={issue} aria={aria}
        sectorRequired={model.sectorRequired} onChange={model.change} onCountyChange={model.changeCounty} />
      <hr />
      <IssuerBrandingFields form={form} disabled={pending} issue={issue} aria={aria}
        branding={model.branding} onChange={model.change} onClearBranding={model.clearBranding} />
      <hr />
      <IssuerVatFields form={form} disabled={pending} issue={issue} aria={aria}
        vatStatus={model.vatStatus} onChange={model.change} onVatRegisteredChange={model.changeVatRegistered} />
      <IssuerVatHistory history={model.vatHistory} />
      <div className="button-row">
        <Button type="submit" disabled={pending || model.branding.pending}>
          {pending ? "Se salvează…" : "Salvează datele firmei"}
        </Button>
      </div>
    </form>
  </section>
}
