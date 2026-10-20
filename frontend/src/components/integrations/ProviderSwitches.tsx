import { Switch } from "../ui/Switch.tsx"
import type { CompanyLookupSettings, SwitchableProvider } from "../../lib/company-lookup-settings.ts"

interface ProviderSwitchesProps {
  readonly settings: CompanyLookupSettings
  readonly disabled: boolean
  readonly onToggle: (provider: SwitchableProvider, on: boolean) => void
}

/** The two providers; at most one is on, and which one is the stored answer, never a guess. */
export const ProviderSwitches = ({ settings, disabled, onToggle }: ProviderSwitchesProps) => {
  const openapiHint = settings.openapiKeyConfigured ? "" : " Pornește după ce salvezi cheia de mai jos."
  return <fieldset className="segmented-fieldset grid gap-4">
    <legend>Furnizor (cel mult unul pornit)</legend>
    <Switch label="ANAF" checked={settings.provider === "anaf"} disabled={disabled}
      description="Gratuit, fără cheie. Completează datele firmei din CUI."
      onChange={(event) => { onToggle("anaf", event.currentTarget.checked) }} />
    <Switch label="openapi.ro" checked={settings.provider === "openapi"} disabled={disabled}
      description={`Cu cheie openapi.ro. Completează datele firmei din CUI și sugerează firme după nume.${openapiHint}`}
      onChange={(event) => { onToggle("openapi", event.currentTarget.checked) }} />
  </fieldset>
}
