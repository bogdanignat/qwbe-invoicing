import { cube as efactura } from "../cubes/invoicing/efactura/index.ts"
import { cube as payments } from "../cubes/invoicing/payments/index.ts"

/**
 * The plugins an installation may switch off. A test loads every unit
 * `qwbe-package.json` declares and holds this list equal to the ones whose
 * manifest says `required: false`.
 */
export const optionalPlugins: ReadonlyArray<string> = [payments, efactura].map((cube) => cube.manifest.name)

/**
 * Which optional plugins this installation runs. Read once, at startup, from
 * `QWBE_PLUGINS`; a change takes a restart. A plugin that is off has no route,
 * no OpenAPI entry, no grant and no service, but its tables and migrations stay.
 */
export interface PluginSelection {
  readonly payments: boolean
  readonly efactura: boolean
}

export const allPlugins: PluginSelection = { payments: true, efactura: true }

export type PluginName = keyof PluginSelection

/** The active plugins, by name, in manifest order: what a browser session is told it may use. */
export const activePluginNames = (selection: PluginSelection): ReadonlyArray<PluginName> =>
  (["payments", "efactura"] as const).filter((name) => selection[name])

/**
 * Absent: every optional plugin. Empty: none. A comma-separated list, spaces
 * ignored, duplicates tolerated. An unknown name refuses to start: a typo must
 * not quietly switch a plugin off.
 */
export const parsePlugins = (value: string | undefined): PluginSelection => {
  if (value === undefined) return allPlugins
  const names = value.split(",").map((name) => name.trim()).filter((name) => name.length > 0)
  const unknown = names.filter((name) => !optionalPlugins.includes(name))
  if (unknown.length > 0) {
    throw new Error(`QWBE_PLUGINS names unknown plugins: ${unknown.join(", ")} (known: ${optionalPlugins.join(", ")})`)
  }
  return { payments: names.includes(payments.manifest.name), efactura: names.includes(efactura.manifest.name) }
}
