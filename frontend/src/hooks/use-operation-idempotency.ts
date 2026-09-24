import { useState } from "react"

import { createOperationIdempotency, type OperationIdempotency } from "../lib/operation-idempotency.ts"

/** One idempotency store per mounted screen: a new session never replays an old answer. */
export const useOperationIdempotency = (): OperationIdempotency => {
  const [value] = useState(createOperationIdempotency)
  return value
}
