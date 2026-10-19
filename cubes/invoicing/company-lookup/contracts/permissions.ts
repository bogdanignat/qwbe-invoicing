/**
 * `lookup` asks a provider about a company; `manageSettings` administers the
 * integration. The second is the parent's existing `settings.manage`, which the
 * host passes in, so the plugin never spells its parent's identity.
 */
export interface CompanyLookupPermissions {
  readonly lookup: string
  readonly manageSettings: string
}

export const companyLookupPermission = (cubeIdentity: string): string => `${cubeIdentity}:company.lookup`
