import { createApiHandler, type ApiRuntime } from "./api.ts"

export interface ApiRequest {
  readonly method: string
  readonly url: string
  readonly authorization: string | undefined
  readonly idempotencyKey?: string
  readonly body: unknown
}

export interface ApiResponse {
  readonly status: number
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

export const handleApiRequest = async (request: ApiRequest, runtime: ApiRuntime): Promise<ApiResponse> => {
  const handler = createApiHandler(runtime)
  try {
    const headers = new Headers({ "content-type": "application/json" })
    if (request.authorization !== undefined) headers.set("authorization", request.authorization)
    if (request.idempotencyKey !== undefined) headers.set("idempotency-key", request.idempotencyKey)
    const withBody = request.method !== "GET" && request.method !== "HEAD"
    const response = await handler.handle(new Request(`http://qwbe.local${request.url}`, {
      method: request.method,
      headers,
      ...(withBody ? { body: JSON.stringify(request.body ?? {}) } : {}),
    }))
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (response.headers.get("content-type")?.startsWith("application/pdf") === true) {
      return { status: response.status, body: bytes, headers: Object.fromEntries(response.headers.entries()) }
    }
    return {
      status: response.status,
      body: bytes.length === 0 ? undefined : JSON.parse(Buffer.from(bytes).toString("utf8")),
    }
  } finally {
    await handler.dispose()
  }
}
