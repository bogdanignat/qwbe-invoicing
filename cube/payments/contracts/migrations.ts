import migrations from "./migrations.json" with { type: "json" }

import type { PaymentsMigration } from "./migration-types.ts"

export type { PaymentsMigration } from "./migration-types.ts"

// Keep the deployed 002 ledger name while moving schema ownership to payments.
export const paymentsMigrations: ReadonlyArray<PaymentsMigration> = migrations
