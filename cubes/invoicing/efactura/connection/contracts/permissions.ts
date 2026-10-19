/**
 * The e-Factura grants. They carry the plugin's name, not this unit's: the
 * connection is the first part of e-Factura to need them, and submissions
 * read under the same `read`.
 */
export interface EFacturaPermissions {
  readonly read: string
  readonly manageConnection: string
  readonly submit: string
  readonly reconcile: string
}

export const efacturaPermissions = (identity: string): EFacturaPermissions => ({
  read: `${identity}:read`,
  manageConnection: `${identity}:connection.manage`,
  submit: `${identity}:submit`,
  reconcile: `${identity}:reconcile`,
})
