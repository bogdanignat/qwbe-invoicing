export interface PaymentsPermissions {
  readonly read: string
  readonly record: string
}

// Payments is a child cube: it checks permissions from its parent's vocabulary, so the
// identity passed here is the level-1 cube's, and the host grants nothing payment-specific.
export const paymentsPermissions = (parentIdentity: string): PaymentsPermissions => ({
  read: `${parentIdentity}:read`,
  record: `${parentIdentity}:payment.record`,
})
