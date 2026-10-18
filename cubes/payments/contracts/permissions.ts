export interface PaymentsPermissions {
  readonly read: string
  readonly record: string
}

export const paymentsPermissions = (cubeIdentity: string): PaymentsPermissions => ({
  read: `${cubeIdentity}:read`,
  record: `${cubeIdentity}:payment.record`,
})

export const legacyPaymentsPermissions: PaymentsPermissions = {
  read: "invoicing:read",
  record: "invoicing:payment.record",
}
