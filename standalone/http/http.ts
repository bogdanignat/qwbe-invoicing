import { createServer, type IncomingMessage, type Server } from "node:http"

import { apiDocsResponse } from "./api-docs.ts"
import { createApiHandler } from "../api/api.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { createBrowserSession } from "../auth/browser-session.ts"
import type { RuntimeConfig } from "../config.ts"
import { createLoginThrottle, type SecurityLogger } from "../auth/login-throttle.ts"
import { databaseReady } from "../storage/migrations.ts"
import { cachedReadiness, readinessIntervalMs } from "./readiness.ts"
import { createRequestListener } from "./http-request-listener.ts"

export { route } from "./http-request-listener.ts"

export interface ServerDependencies {
  readonly now?: () => number
  readonly monotonicNow?: () => number
  readonly securityLogger?: SecurityLogger
  readonly peerKey?: (request: IncomingMessage) => string | undefined
  readonly apiHandlerFactory?: typeof createApiHandler
}
export interface RunningServer {
  readonly server: Server
  readonly close: () => Promise<void>
}

const listen = (server: Server, config: RuntimeConfig): Promise<void> => new Promise((resolve, reject) => {
  const onError = (error: Error) => { server.off("listening", onListening); reject(error) }
  const onListening = () => { server.off("error", onError); resolve() }
  server.once("error", onError)
  server.once("listening", onListening)
  server.listen(config.port, config.host)
})

export const startServer = async (
  config: RuntimeConfig,
  isReady: () => boolean = cachedReadiness(() => databaseReady(config.dataDirectory), readinessIntervalMs),
  renderApiDocs: () => Promise<Awaited<ReturnType<typeof apiDocsResponse>>> = apiDocsResponse,
  dependencies: ServerDependencies = {},
): Promise<RunningServer> => {
  const authenticate = createRequestAuthenticator(config)
  const now = dependencies.now ?? Date.now
  const browserSession = createBrowserSession(config, now)
  const throttle = createLoginThrottle({ now,
    ...(dependencies.monotonicNow === undefined ? {} : { monotonicNow: dependencies.monotonicNow }),
    ...(dependencies.securityLogger === undefined ? {} : { logger: dependencies.securityLogger }) })
  const apiFactory = dependencies.apiHandlerFactory ?? createApiHandler
  const api = apiFactory({ authenticate, dataDirectory: config.dataDirectory, browserSession })
  let disposePromise: Promise<void> | undefined
  const dispose = () => disposePromise ??= api.dispose()
  let closePromise: Promise<void> | undefined
  const server = createServer(createRequestListener({
    authenticate,
    browserSession,
    throttle,
    api,
    isReady,
    renderApiDocs,
    ...(dependencies.peerKey === undefined ? {} : { peerKey: dependencies.peerKey }),
  }))
  const close = (): Promise<void> => closePromise ??= (async () => {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }))
    } finally {
      await dispose()
    }
  })()
  server.once("close", () => { void dispose() })
  try {
    await listen(server, config)
  } catch (error) {
    await dispose()
    throw error
  }
  console.log(`QWBE Invoicing listening on http://${config.host}:${String(config.port)}`)
  return { server, close }
}
