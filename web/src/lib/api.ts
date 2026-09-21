import { Cause, Effect, Exit, Option } from "effect"
import type { ApiFailure } from "./api-errors.ts"

export { ApiFailure } from "./api-errors.ts"
export { apiBlob, apiRequest } from "./api-transport.ts"
export { clearApiSession, onUnauthorized } from "./api-session-state.ts"
export { loginApiSession, logoutApiSession, restoreApiSession } from "./api-session.ts"

export const runUiEffect = async <Value>(effect: Effect.Effect<Value, ApiFailure>, signal?: AbortSignal): Promise<Value> => {
  const exit = signal === undefined ? await Effect.runPromiseExit(effect) : await Effect.runPromiseExit(effect, { signal })
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) throw failure.value
  throw Cause.squash(exit.cause)
}
