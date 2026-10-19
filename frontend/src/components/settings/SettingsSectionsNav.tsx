import { usePluginEnabled } from "../../hooks/use-plugin-enabled.ts"
import { settingsSections, type SettingsSection } from "../../lib/settings-sections.ts"

/** Emitent | Integrări; nothing at all while the company-lookup plugin is off. */
export const SettingsSectionsNav = ({ current }: { readonly current: SettingsSection }) => {
  const sections = settingsSections(usePluginEnabled("company-lookup"), current)
  if (sections.length === 0) return null
  return <nav className="settings-sections" aria-label="Secțiuni setări">
    {sections.map((link) => <a key={link.section} className="button secondary" href={link.href}
      aria-current={link.current ? "page" : undefined}>{link.label}</a>)}
  </nav>
}
