import type { Effect } from "effect"

import type { NameCursor, PageQuery, TransactionFailure } from "../../application/ports.ts"
import type { PersistenceFailure } from "../../contracts/failures.ts"
import type { Customer } from "../domain/customer.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write = Effect.Effect<void, TransactionFailure>

// Runs inside the same transaction as the rest of invoicing: the host composes this
// port with the kernel port over one connection, so a draft never sees half a customer.
export interface CustomersTransaction {
  readonly saveCustomer: (customer: Customer) => Write
  readonly findCustomer: (organizationId: string, id: string) => Read<Customer | undefined>
  // At most limit + 1 rows ordered by name then id; `after` is the key of the last item of the previous page.
  readonly listCustomers: (organizationId: string, page: PageQuery<NameCursor>) => Read<ReadonlyArray<Customer>>
  readonly softDeleteCustomer: (organizationId: string, id: string, deletedAt: string) => Write
  // Offered by the host so a customer still used by an open draft is kept; it gives
  // this cube no ownership of drafts.
  readonly hasOpenDraftsForCustomer: (organizationId: string, customerId: string) => Read<boolean>
}
