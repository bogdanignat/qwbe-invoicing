import type { Pool } from "pg"

import type { Transport } from "../outbound/send.ts"
import type { AnafSettings } from "./anaf/config.ts"
import { AnafEnvironmentMismatch, assertAnafEnvironment } from "./anaf/environment-guard.ts"
import { startDispatcher, type Dispatcher, type DispatcherOptions } from "./dispatch/dispatcher.ts"

export interface EFacturaRuntimeOptions extends Omit<DispatcherOptions, "anaf" | "transport"> {
  /** The query pool: the environment guard reads through it. */
  readonly pool: Pool
  readonly anaf: AnafSettings
  readonly transport?: Transport
  /** `QWBE_PLUGINS` has e-Factura on: only then does the dispatcher run. The guard runs regardless. */
  readonly pluginOn: boolean
  /** The database's readiness: the schema is current and the barrier held. Not the guard: traffic waits for both. */
  readonly ready: () => Promise<boolean>
  /** `ANAF_ENVIRONMENT` is not the one the stored submissions were made in: `serve` must not go on. */
  readonly onRefused: (message: string) => void
  readonly readyPollMs?: number
}

export interface EFacturaRuntime {
  /** The environment guard passed. Until then `serve` takes no traffic, so no submit can write in another environment. */
  readonly environmentChecked: () => boolean
  /** Stops the dispatcher (if it runs) and gives up waiting for readiness. Idempotent. */
  readonly stop: () => Promise<void>
}

const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref() })

/**
 * The e-Factura side of `serve`, started after HTTP is up: wait for the
 * database, check `ANAF_ENVIRONMENT` against the stored submissions, and only
 * then let traffic in and run the dispatcher if the plugin is on. A guard that
 * cannot read the database yet is asked again; a guard that refuses ends
 * `serve` through `onRefused`, and traffic never comes in.
 */
export const startEFacturaRuntime = (options: EFacturaRuntimeOptions): EFacturaRuntime => {
  const state = { stopped: false, checked: false, dispatcher: undefined as Dispatcher | undefined }
  const started = (async () => {
    while (!state.stopped) {
      try {
        if (await options.ready()) {
          await assertAnafEnvironment(options.pool, options.anaf.environment)
          state.checked = true
          break
        }
      } catch (error) {
        if (error instanceof AnafEnvironmentMismatch) {
          options.onRefused(error.message)
          return
        }
      }
      await pause(options.readyPollMs ?? 1_000)
    }
    if (state.stopped || !options.pluginOn) return
    state.dispatcher = startDispatcher({ ...options, transport: options.transport ?? fetch })
  })()
  let stopping: Promise<void> | undefined
  return {
    environmentChecked: () => state.checked,
    stop: () => stopping ??= (async () => {
      state.stopped = true
      await started
      await state.dispatcher?.stop()
    })(),
  }
}
