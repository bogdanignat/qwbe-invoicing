import { ApiFailure } from "./api-errors.ts"

export interface OperationIdempotency {
  /** The key for this operation and payload fingerprint, reused until it is settled. */
  readonly current: (operation: string, fingerprint: string) => string
  /** The operation succeeded: any later attempt is a new operation and gets a new key. */
  readonly complete: (operation: string) => void
  /**
   * The operation failed. A gateway or server failure can arrive after the
   * transaction committed, so the answer may exist and only the server's
   * idempotency store can hand it back: the key is kept and a retry replays it.
   * A settled client error (4xx other than 408) says the request never
   * committed, so the key is dropped and the next attempt starts fresh.
   */
  readonly fail: (operation: string, fingerprint: string, error: Error) => void
}

export const createOperationIdempotency = (
  newKey: () => string = () => crypto.randomUUID(),
): OperationIdempotency => {
  const keys = new Map<string, string>()
  const identity = (operation: string, fingerprint: string): string => `${operation}\u0000${fingerprint}`
  const current = (operation: string, fingerprint: string): string => {
    const id = identity(operation, fingerprint)
    const existing = keys.get(id)
    if (existing !== undefined) return existing
    const key = newKey()
    keys.set(id, key)
    return key
  }
  const complete = (operation: string): void => {
    for (const id of keys.keys()) if (id.startsWith(`${operation}\u0000`)) keys.delete(id)
  }
  const fail = (operation: string, fingerprint: string, error: Error): void => {
    if (error instanceof ApiFailure && error.status !== undefined
      && error.status >= 400 && error.status < 500 && error.status !== 408) {
      keys.delete(identity(operation, fingerprint))
    }
  }
  return { current, complete, fail }
}

/**
 * A canonical fingerprint of the payload an operation carries: object keys
 * are sorted, so "the same intent" keeps one key across attempts while an
 * edited payload cannot replay an older answer under the old key.
 */
export const operationFingerprint = (payload: unknown): string => JSON.stringify(payload, (_key, value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
    : value)
