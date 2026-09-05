import { useRef } from "react"

import { ApiFailure } from "./api.ts"

export const useIdempotencyKey = () => {
  const key = useRef<string | undefined>(undefined)
  const current = (): string => {
    key.current ??= crypto.randomUUID()
    return key.current
  }
  const complete = (): void => { key.current = undefined }
  const fail = (error: Error): void => {
    if (error instanceof ApiFailure && error.status !== undefined) key.current = undefined
  }
  return { current, complete, fail }
}
