export const maximumRequestBodyBytes = 1_000_000

export class RequestBodyTooLarge extends Error {}
export class RequestBodyTimeout extends Error {}
export class RequestBodyAborted extends Error {}

export const readBoundedRequestBody = async (request: Request, deadlineAt = Number.POSITIVE_INFINITY): Promise<Uint8Array | undefined> => {
  if (request.body === null) return undefined
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumRequestBodyBytes)) {
    void request.body.cancel(new RequestBodyTooLarge()).catch(() => {})
    throw new RequestBodyTooLarge()
  }
  const reader = request.body.getReader()
  const chunks: Array<Uint8Array> = []
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectStop: ((error: Error) => void) | undefined
  let stoppedWith: Error | undefined
  const cancel = (error: Error): void => {
    if (stoppedWith !== undefined) return
    stoppedWith = error
    rejectStop?.(error)
    void reader.cancel(error).catch(() => {})
  }
  const abort = (): void => { cancel(new RequestBodyAborted()) }
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject })
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) cancel(new RequestBodyTimeout())
  if (Number.isFinite(remaining) && remaining > 0) timer = setTimeout(() => { cancel(new RequestBodyTimeout()) }, remaining)
  if (request.signal.aborted) abort()
  else request.signal.addEventListener("abort", abort, { once: true })
  try {
    let item = await Promise.race([reader.read(), stopped])
    while (!item.done) {
      length += item.value.byteLength
      if (length > maximumRequestBodyBytes) {
        void reader.cancel(new RequestBodyTooLarge()).catch(() => {})
        throw new RequestBodyTooLarge()
      }
      chunks.push(item.value)
      item = await Promise.race([reader.read(), stopped])
    }
    if (stoppedWith !== undefined) throw stoppedWith
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    request.signal.removeEventListener("abort", abort)
    try { reader.releaseLock() } catch { /* a cancelled pending read retains the lock until it settles */ }
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
