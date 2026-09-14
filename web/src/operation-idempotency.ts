import { useState } from "react"

import { ApiFailure } from "./api.ts"

export interface OperationIdempotency {
  readonly current: (operation: string, fingerprint: string) => string
  readonly complete: (operation: string) => void
  readonly fail: (operation: string, fingerprint: string, error: Error) => void
}

export const createOperationIdempotency = (newKey: () => string = () => crypto.randomUUID()): OperationIdempotency => {
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
    // A gateway/server failure can arrive after the transaction committed: retry with the same key.
    if (error instanceof ApiFailure && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408) {
      keys.delete(identity(operation, fingerprint))
    }
  }
  return { current, complete, fail }
}

export const useOperationIdempotency = (): OperationIdempotency => {
  const [value] = useState(createOperationIdempotency)
  return value
}
