const INVALID_SESSION = "Forma sesiunii este invalidă."

const record = (input: unknown): Readonly<Record<string, unknown>> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error(INVALID_SESSION)
  return input as Readonly<Record<string, unknown>>
}

/** The optional plugins the backend may run; any other name in a session answer is a contract break. */
export type PluginName = "payments" | "efactura"
const pluginNames: ReadonlyArray<unknown> = ["payments", "efactura"] satisfies ReadonlyArray<PluginName>

export interface AuthenticatedSession {
  readonly authenticated: true
  readonly csrfToken: string
  /** The plugins this installation runs: the browser asks nothing of one that is not listed. */
  readonly plugins: ReadonlyArray<PluginName>
}

const decodePlugins = (input: unknown): ReadonlyArray<PluginName> => {
  if (!Array.isArray(input) || !input.every((name) => pluginNames.includes(name))) throw new Error(INVALID_SESSION)
  return input as ReadonlyArray<PluginName>
}

export const decodeAuthenticatedSession = (input: unknown): AuthenticatedSession => {
  const value = record(input)
  if (value.authenticated !== true || typeof value.csrfToken !== "string" || value.csrfToken.length === 0) {
    throw new Error(INVALID_SESSION)
  }
  return { authenticated: true, csrfToken: value.csrfToken, plugins: decodePlugins(value.plugins) }
}

export const decodeLoggedOutSession = (input: unknown): void => {
  if (record(input).authenticated !== false) throw new Error(INVALID_SESSION)
}
