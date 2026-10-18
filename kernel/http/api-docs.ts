import { HttpApiSwagger, HttpLayerRouter } from "@effect/platform"

import { activeHttpApi } from "../api/http-api.ts"
import type { PluginSelection } from "../plugins.ts"

export interface ApiDocsResponse {
  readonly status: number
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string>>
}

export interface ApiDocsHandler {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

const swaggerHandler = (plugins: PluginSelection) => (): ApiDocsHandler => HttpLayerRouter.toWebHandler(
  HttpApiSwagger.layerHttpLayerRouter({ api: activeHttpApi(plugins), path: "/api" }),
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
  createHandler: () => ApiDocsHandler,
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

/** The docs of this installation: only the routes of the plugins it runs. Cached per server, not globally. */
export const apiDocsResponse = (plugins: PluginSelection): (() => Promise<ApiDocsResponse>) =>
  makeApiDocsResponse(swaggerHandler(plugins))
