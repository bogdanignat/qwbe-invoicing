/**
 * The tabs of the settings screen, as data. The issuer stays at `/settings`;
 * Integrări exists only while the company-lookup plugin runs, and a menu with a
 * single entry is no menu, so with the plugin off there is none at all.
 */
export type SettingsSection = "issuer" | "integrations"

export interface SettingsSectionLink {
  readonly section: SettingsSection
  readonly href: string
  readonly label: string
  readonly current: boolean
}

const SECTIONS: ReadonlyArray<Omit<SettingsSectionLink, "current">> = [
  { section: "issuer", href: "/settings", label: "Emitent" },
  { section: "integrations", href: "/settings/integrations", label: "Integrări" },
]

const NO_SECTIONS: ReadonlyArray<SettingsSectionLink> = []

export const settingsSections = (companyLookup: boolean, current: SettingsSection): ReadonlyArray<SettingsSectionLink> =>
  companyLookup ? SECTIONS.map((link) => ({ ...link, current: link.section === current })) : NO_SECTIONS
