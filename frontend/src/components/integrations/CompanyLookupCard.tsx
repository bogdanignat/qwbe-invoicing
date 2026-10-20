import { OpenapiKeyField } from "./OpenapiKeyField.tsx"
import { ProviderSwitches } from "./ProviderSwitches.tsx"
import type { CompanyLookupSettingsModel } from "../../hooks/use-company-lookup-settings.ts"
import type { CompanyLookupSettings } from "../../lib/company-lookup-settings.ts"

interface CompanyLookupCardProps {
  readonly model: CompanyLookupSettingsModel
  readonly settings: CompanyLookupSettings
}

/** Completing companies from a CUI: the provider switches, then the openapi.ro key they may need. */
export const CompanyLookupCard = ({ model, settings }: CompanyLookupCardProps) =>
  <section className="card form-card" aria-labelledby="company-lookup-title">
    <div className="section-heading"><div>
      <h2 id="company-lookup-title">Completarea datelor firmelor</h2>
      <p>Furnizorul pornit completează denumirea, adresa și datele fiscale ale unei firme după CUI, în fișa clientului și în datele emitentului. Fiecare schimbare se salvează imediat.</p>
    </div></div>
    {model.notice === undefined ? null : <p className="status-note" role="status">{model.notice}</p>}
    {model.failure === undefined ? null : <p className="status-note warning" role="alert">{model.failure}</p>}
    <ProviderSwitches settings={settings} disabled={model.pending} onToggle={model.toggle} />
    <hr />
    <OpenapiKeyField settings={settings} editor={model.key} disabled={model.pending} />
  </section>
