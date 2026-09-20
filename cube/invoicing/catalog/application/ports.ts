import type { Effect } from "effect"

import type { NameCursor, PageQuery, TransactionFailure } from "../../application/ports.ts"
import type { PersistenceFailure } from "../../contracts/failures.ts"
import type { ProductPreset } from "../domain/product-preset.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write = Effect.Effect<void, TransactionFailure>

// Runs inside the same transaction as the rest of invoicing: the host composes this
// port with the kernel port over one connection.
export interface CatalogTransaction {
  readonly saveProductPreset: (preset: ProductPreset) => Write
  readonly findProductPreset: (organizationId: string, id: string) => Read<ProductPreset | undefined>
  // At most limit + 1 rows ordered by description then id; `after` is the key of the last item of the previous page.
  readonly listProductPresets: (organizationId: string, page: PageQuery<NameCursor>) => Read<ReadonlyArray<ProductPreset>>
  readonly deleteProductPreset: (organizationId: string, id: string) => Write
}
