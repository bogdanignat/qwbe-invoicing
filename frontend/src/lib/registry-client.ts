import { decodeDeleted } from "./draft-decoders.ts"
import { decodeCustomer, decodeProductPreset } from "./registry-decoders.ts"
import { encoded } from "./client-paths.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { BuyerSnapshot, Customer, ProductPreset, UnitOfMeasure } from "./draft-models.ts"

/**
 * The master-data writes: customers and product presets, created, updated and
 * deleted.
 *
 * Kept apart from `authoring-reference-client.ts`, which stays read-only: an
 * authoring session must not be able to reach a write through the client it
 * reads its registries with.
 *
 * Every write states the session's CSRF token, and none of them carries an
 * idempotency key — the backend requires one only for the fiscal writes
 * (`standalone/api/http-endpoints-master-data.ts` declares CSRF alone), and
 * there would be nothing to replay it with: a master-data record is not sealed,
 * it is visible in the registry this screen already shows, and a duplicate can
 * simply be deleted. That is also why these writes do not pass through
 * `readableWrite`: an unreadable answer here is an ordinary failure, not an
 * outcome the recovery journal has to hold open.
 */
export interface CustomerInput extends BuyerSnapshot {
  readonly defaultPaymentTermDays?: number
}

export interface ProductPresetInput {
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  /** Absent means "the issuer's default rate on the document date", never an empty code. */
  readonly preferredVatRateCode?: string
}

export interface RegistryClient {
  readonly createCustomer: (csrfToken: string, body: CustomerInput) => Promise<Customer>
  readonly updateCustomer: (csrfToken: string, id: string, body: CustomerInput) => Promise<Customer>
  readonly deleteCustomer: (csrfToken: string, id: string) => Promise<void>
  readonly createProductPreset: (csrfToken: string, body: ProductPresetInput) => Promise<ProductPreset>
  readonly updateProductPreset: (csrfToken: string, id: string, body: ProductPresetInput) => Promise<ProductPreset>
  readonly deleteProductPreset: (csrfToken: string, id: string) => Promise<void>
}

export const createRegistryClient = (transport: BrowserTransport): RegistryClient => {
  const write = async <T>(
    path: string, csrfToken: string, method: "POST" | "PUT" | "DELETE", body: unknown,
    decode: (value: unknown) => T,
  ): Promise<T> => decode(await transport.json(path, {
    csrfToken, method, ...(body === undefined ? {} : { body }),
  }))
  const remove = async (path: string, csrfToken: string): Promise<void> => {
    await write(path, csrfToken, "DELETE", undefined, decodeDeleted)
  }
  return {
    createCustomer: (csrfToken, body) =>
      write("/api/customers", csrfToken, "POST", body, decodeCustomer),
    updateCustomer: (csrfToken, id, body) =>
      write(`/api/customers/${encoded(id)}`, csrfToken, "PUT", body, decodeCustomer),
    deleteCustomer: (csrfToken, id) => remove(`/api/customers/${encoded(id)}`, csrfToken),
    createProductPreset: (csrfToken, body) =>
      write("/api/product-presets", csrfToken, "POST", body, decodeProductPreset),
    updateProductPreset: (csrfToken, id, body) =>
      write(`/api/product-presets/${encoded(id)}`, csrfToken, "PUT", body, decodeProductPreset),
    deleteProductPreset: (csrfToken, id) => remove(`/api/product-presets/${encoded(id)}`, csrfToken),
  }
}
