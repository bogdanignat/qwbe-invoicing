// A 500 says "internal_failure" and nothing more, on purpose: the caller cannot
// act on a bug in the server, and a leaked reason is a leaked internal. That
// opacity is only honest if the reason survives on this side, so every such
// answer writes exactly one line here first. Without it a defect leaves no
// trace at all and the next bug report is "salvarea a eșuat" with nothing to go
// on — which is how this module came to exist.
const reasonLimit = 4000

export interface InternalFailure {
  // Where the answer was decided: an unmapped domain failure, a declared server
  // failure whose wire tag drops the reason, a defect caught by the API
  // middleware, or a throw in the plain HTTP layer.
  readonly kind: "unmapped_failure" | "server_failure" | "defect" | "api_docs" | "request"
  readonly reason: string
}

export const internalFailureLine = (failure: InternalFailure): string => JSON.stringify({
  event: "internal_failure", kind: failure.kind, reason: failure.reason.slice(0, reasonLimit),
})

export const logInternalFailure = (failure: InternalFailure): void => {
  process.stderr.write(`${internalFailureLine(failure)}\n`)
}

export const failureReason = (error: unknown): string => error instanceof Error
  ? `${error.name}: ${error.message}`
  : String(error)
