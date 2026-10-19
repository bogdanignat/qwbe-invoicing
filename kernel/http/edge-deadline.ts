import type { ServerResponse } from "node:http"

/**
 * One deadline for the whole request at the edge: reading the body, readiness,
 * the docs, the API handler and materialising its answer. Node's
 * `requestTimeout`/`headersTimeout` only bound the receiving of a request, not
 * what the handler does once it has it.
 *
 * The signal is the cancellation the rest of the request sees: it is aborted
 * when the deadline passes or when the client goes away first, it travels into
 * the handler's `Request.signal` (the Effect runtime interrupts the handler's
 * fiber on it), and `untilAborted` releases every await on it. Interrupting a
 * handler is not a rollback guarantee: a write that already committed stays
 * committed, and the client simply does not learn its outcome.
 */
export const requestDeadlineMs = 30_000

export class RequestDeadlineExceeded extends Error {
  override readonly name = "RequestDeadlineExceeded"
}

export class ClientDisconnected extends Error {
  override readonly name = "ClientDisconnected"
}

export const startDeadline = (response: ServerResponse, deadlineMs: number, onExpired: () => void): AbortSignal => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new RequestDeadlineExceeded())
    onExpired()
  }, deadlineMs)
  // An open socket keeps the process alive, the deadline on its own does not.
  timer.unref()
  response.once("close", () => {
    clearTimeout(timer)
    if (!response.writableFinished) controller.abort(new ClientDisconnected())
  })
  return controller.signal
}

/** The promise's outcome, or the signal's reason if the signal is aborted first. */
export const untilAborted = <Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> => {
  if (signal.aborted) {
    promise.catch(() => {})
    return Promise.reject(signal.reason as Error)
  }
  return new Promise((resolve, reject) => {
    const abort = () => { reject(signal.reason as Error) }
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => { signal.removeEventListener("abort", abort) })
  })
}
