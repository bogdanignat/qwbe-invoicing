/**
 * The main navigation, as data.
 *
 * Which section is current is a question about the path, not about the markup,
 * so it is answered here and asserted in a test: the sidebar only renders what
 * this says. The sections match the canonical UI routes, and a route that is
 * not one of them (the unlock screen, a document detail under a section) still
 * resolves to the section it belongs to rather than to nothing. Integrări is
 * listed only while an integration plugin runs (`integrationsActive`), and
 * Facturi primite only while e-Factura does.
 */
export interface ShellLink {
  readonly href: string
  readonly section: string
  readonly label: string
  readonly icon: string
}

export interface ShellNavItem extends ShellLink {
  /** `aria-current="page"` belongs to exactly one link, and only once the session is open. */
  readonly current: boolean
}

export const SHELL_LINKS: ReadonlyArray<ShellLink> = [
  { href: "/", section: "home", label: "Acasă", icon: "⌂" },
  { href: "/invoices", section: "invoices", label: "Facturi", icon: "▤" },
  { href: "/received", section: "received", label: "Facturi primite", icon: "⇩" },
  { href: "/proformas", section: "proformas", label: "Proforme", icon: "▧" },
  { href: "/customers", section: "customers", label: "Clienți", icon: "♙" },
  { href: "/products", section: "products", label: "Nomenclator produse", icon: "◇" },
  { href: "/settings", section: "settings", label: "Setări", icon: "⚙" },
  { href: "/integrations", section: "integrations", label: "Integrări", icon: "⇄" },
]

/** The first path segment: `/invoices/inv-1` is still the invoices section, and `/` is home. */
export const activeShellSection = (pathname: string): string => {
  const segment = pathname.split("/")[1] ?? ""
  return segment === "" ? "home" : segment
}

/** The sections that exist only with a plugin on; every other one is always listed. */
export interface PluginSections {
  readonly integrations: boolean
  readonly received: boolean
}

const listed = (link: ShellLink, plugins: PluginSections): boolean => {
  if (link.section === "integrations") return plugins.integrations
  if (link.section === "received") return plugins.received
  return true
}

export const shellNavigation = (pathname: string, unlocked: boolean, plugins: PluginSections): ReadonlyArray<ShellNavItem> => {
  const section = activeShellSection(pathname)
  return SHELL_LINKS
    .filter((link) => listed(link, plugins))
    .map((link) => ({ ...link, current: unlocked && link.section === section }))
}
