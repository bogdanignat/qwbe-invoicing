import { useAuth } from "./auth-context.ts"
import type { PluginName } from "../lib/api-contracts.ts"
import { pluginActive } from "../lib/plugins.ts"

/** Whether this installation runs the plugin, read from the session already in context. */
export const usePluginEnabled = (name: PluginName): boolean => pluginActive(useAuth(), name)
