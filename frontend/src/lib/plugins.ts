import type { PluginName } from "./api-contracts.ts"
import type { AuthSnapshot } from "./auth-session.ts"

/**
 * Whether the session in place runs a plugin. Outside an authenticated session
 * none is on, so a screen still mounted during a logout asks nothing of one.
 */
export const pluginActive = (session: Pick<AuthSnapshot, "status" | "plugins">, name: PluginName): boolean =>
  session.status === "authenticated" && session.plugins.includes(name)

/** Integrări exists while an integration plugin runs: company lookup or e-Factura. */
export const integrationsActive = (session: Pick<AuthSnapshot, "status" | "plugins">): boolean =>
  pluginActive(session, "company-lookup") || pluginActive(session, "efactura")
