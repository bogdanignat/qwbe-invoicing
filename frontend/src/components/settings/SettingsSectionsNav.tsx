import { usePluginEnabled } from "../../hooks/use-plugin-enabled.ts"
import { settingsSections, type SettingsSection } from "../../lib/settings-sections.ts"

/** Emitent | Integrări; nothing at all while no integration plugin (company lookup, e-Factura) is on. */
export const SettingsSectionsNav = ({ current }: { readonly current: SettingsSection }) => {
  const companyLookup = usePluginEnabled("company-lookup")
  const eFactura = usePluginEnabled("efactura")
  const sections = settingsSections(companyLookup || eFactura, current)
  if (sections.length === 0) return null
  return <nav className="settings-sections" aria-label="Secțiuni setări">
    {sections.map((link) => <a key={link.section} className="button secondary" href={link.href}
      aria-current={link.current ? "page" : undefined}>{link.label}</a>)}
  </nav>
}
