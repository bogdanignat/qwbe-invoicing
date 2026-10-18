import migrations from "./migrations.json" with { type: "json" }

import type { PaymentsMigration } from "./migration-types.ts"

export type { PaymentsMigration } from "./migration-types.ts"

export const paymentsMigrations: ReadonlyArray<PaymentsMigration> = migrations
