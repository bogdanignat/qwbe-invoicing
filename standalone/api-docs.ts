import { HttpApiSwagger, HttpLayerRouter } from "@effect/platform"

import { applicationHttpApi } from "./http-api.ts"

export interface ApiDocsResponse {
  readonly status: number
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string>>
}

export interface ApiDocsHandler {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

const createSwaggerHandler = (): ApiDocsHandler => HttpLayerRouter.toWebHandler(
  HttpApiSwagger.layerHttpLayerRouter({ api: applicationHttpApi, path: "/api" }),
  { disableLogger: true },
)

const render = async (createHandler: () => ApiDocsHandler): Promise<ApiDocsResponse> => {
  const swagger = createHandler()
  try {
    const response = await swagger.handler(new Request("http://localhost/api"))
    return {
      status: response.status,
      body: new Uint8Array(await response.arrayBuffer()),
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
        "x-content-type-options": "nosniff",
      },
    }
  } finally {
    await swagger.dispose()
  }
}

export const makeApiDocsResponse = (
  createHandler: () => ApiDocsHandler = createSwaggerHandler,
): (() => Promise<ApiDocsResponse>) => {
  let materialized: Promise<ApiDocsResponse> | undefined
  return () => {
    materialized ??= render(createHandler).catch((error: unknown) => {
      materialized = undefined
      throw error
    })
    return materialized
  }
}

export const apiDocsResponse = makeApiDocsResponse()
