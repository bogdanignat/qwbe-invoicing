import { createServer, type IncomingMessage, type Server } from "node:http"

import type { Pool } from "pg"

import { apiDocsResponse } from "./api-docs.ts"
import { createApiHandler } from "../api/api.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { createBrowserSession } from "../auth/browser-session.ts"
import type { RuntimeConfig } from "../config.ts"
import { createLoginThrottle, type SecurityLogger } from "../auth/login-throttle.ts"
import { artifactsDirectoryReady, databaseReady } from "../storage/migrations.ts"
import { cachedReadiness, readinessIntervalMs } from "./readiness.ts"
import { createRequestListener } from "./http-request-listener.ts"

export { route } from "./http-request-listener.ts"

export interface ServerDependencies {
  /**
   * Whether the caller holds the SHARED maintenance barrier. The seam is here
   * and its default is FAIL-CLOSED (`() => false`): the previous default said
   * `() => true` on the caller's behalf, which served `/api*` and answered
   * `/health/ready` 200 while a `migrate`/`backup`/`restore` could be running.
   * `serve` passes `barrier.held`; a caller that deliberately holds no barrier
   * says `() => true` out loud, as the signature of `applicationReady` requires.
   */
  readonly barrierHeld?: () => boolean
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

/**
 * The three things readiness means, in one place: the maintenance barrier is
 * held, the artifact directory is writable, and the schema the ledger describes
 * is the schema that is there. `barrierHeld` has NO default: a caller that holds
 * no barrier has to say `() => true` out loud, so the guarantee is carried by
 * the signature instead of by convention. `serve` passes the real one, so an
 * application without the barrier answers 503 on `/health/ready` and on every
 * `/api*` route while `/health/live` keeps answering 200.
 *
 * It is deliberately not cached here. `cachedReadiness` wraps it, so the cache
 * and the single-flight live in exactly one place.
 */
export const applicationReady = (
  config: RuntimeConfig,
  pool: Pool,
  barrierHeld: () => boolean,
  /**
   * Why readiness answered what it did. Codes only, and for a failed evaluation
   * the error's `name` and never its message: a driver error carries the
   * connection configuration, password included. "I could not evaluate drift"
   * and "I found drift" are different codes, because the first one used to be
   * indistinguishable from the second — an unreadable schema answered 503 with
   * no diagnostic at all.
   */
  report: (reason: string) => void = () => {},
) => async (): Promise<boolean> => {
  if (!barrierHeld()) { report("maintenance_barrier_not_held"); return false }
  if (!artifactsDirectoryReady(config.dataDirectory)) { report("artifact_directory_not_writable"); return false }
  try {
    const ready = await databaseReady(pool)
    if (!ready) report("schema_pending_or_drifted")
    return ready
  } catch (error) {
    report(`schema_check_failed:${error instanceof Error ? error.name : "unknown"}`)
    // Rethrown so `cachedReadiness` applies the fail-closed rule in one place.
    throw error
  }
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
  /** The application pool. The server borrows it and never ends it. */
  pool: Pool,
  isReady?: () => Promise<boolean>,
  renderApiDocs: () => Promise<Awaited<ReturnType<typeof apiDocsResponse>>> = apiDocsResponse,
  dependencies: ServerDependencies = {},
): Promise<RunningServer> => {
  const ready = isReady ?? cachedReadiness(
    applicationReady(config, pool, dependencies.barrierHeld ?? (() => false)),
    readinessIntervalMs,
  )
  const authenticate = createRequestAuthenticator(config)
  const now = dependencies.now ?? Date.now
  const browserSession = createBrowserSession(config, pool, now)
  const throttle = createLoginThrottle({ now,
    ...(dependencies.monotonicNow === undefined ? {} : { monotonicNow: dependencies.monotonicNow }),
    ...(dependencies.securityLogger === undefined ? {} : { logger: dependencies.securityLogger }) })
  const apiFactory = dependencies.apiHandlerFactory ?? createApiHandler
  const api = apiFactory({ authenticate, pool, dataDirectory: config.dataDirectory, browserSession })
  let disposePromise: Promise<void> | undefined
  const dispose = () => disposePromise ??= api.dispose()
  let closePromise: Promise<void> | undefined
  const server = createServer(createRequestListener({
    authenticate,
    browserSession,
    throttle,
    api,
    isReady: ready,
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
