import { ApiFailure, parseApiFailure } from "./api-errors.ts"
import { browserApiPath } from "./api-path.ts"

export interface TransportOptions {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE"
  readonly body?: unknown
  readonly csrfToken?: string
  readonly idempotencyKey?: string
  readonly accept?: string
  readonly signal?: AbortSignal
  readonly unauthorized?: "notify" | "ignore"
}

export interface BrowserTransport {
  readonly json: (path: string, options?: TransportOptions) => Promise<unknown>
  readonly binary: (path: string, options?: TransportOptions) => Promise<Blob>
}

interface Dependencies {
  readonly fetch?: typeof fetch
  readonly onUnauthorized: () => void
}

export const createBrowserTransport = ({ fetch: fetchImpl = fetch, onUnauthorized }: Dependencies): BrowserTransport => {
  const response = async (path: string, options: TransportOptions = {}): Promise<Response> => {
    const method = options.method ?? "GET"
    let result: Response
    try {
      result = await fetchImpl(browserApiPath(path), {
        method,
        credentials: "same-origin",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        headers: {
          accept: options.accept ?? "application/json",
          ...(options.csrfToken === undefined ? {} : { "x-csrf-token": options.csrfToken }),
          ...(options.idempotencyKey === undefined ? {} : { "idempotency-key": options.idempotencyKey }),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") throw cause
      throw new ApiFailure({ message: cause instanceof Error ? cause.message : "Conexiunea cu API-ul a eșuat." })
    }
    if (result.status === 401 && options.unauthorized !== "ignore") onUnauthorized()
    if (!result.ok) {
      const body = await readJson(result).catch(() => undefined)
      throw parseApiFailure(body, result.status)
    }
    return result
  }

  return {
    json: async (path, options) => readJson(await response(path, options)),
    binary: async (path, options = {}) => (await response(path, { ...options, accept: options.accept ?? "application/octet-stream" })).blob(),
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json() as unknown
  } catch {
    throw new ApiFailure({ message: "API-ul a returnat un răspuns JSON invalid.", status: response.status })
  }
}
