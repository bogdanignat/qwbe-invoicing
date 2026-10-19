import { Effect, Exit, Fiber } from "effect"

import type { AnafSettings } from "../anaf/config.ts"
import { connectionHost } from "../anaf/connection-host.ts"
import { createSubmissionGateway } from "../anaf/submission-gateway.ts"
import type { Transport } from "../../outbound/send.ts"
import { dispatchStore } from "../../storage/postgres-efactura-dispatch.ts"
import { acquireLease, type DispatcherLease } from "../../storage/postgres-efactura-lease.ts"
import type { PostgresSettings } from "../../storage/postgres-pool.ts"
import { dispatcherCredentials } from "./credentials.ts"
import { dispatchOne, type StepContext } from "./dispatch-step.ts"

export interface DispatcherOptions {
  /** The database the dedicated connection is opened on. */
  readonly settings: PostgresSettings
  readonly anaf: AnafSettings
  readonly transport: Transport
  /** The process's maintenance barrier: without it nothing is taken and nothing in flight goes on. */
  readonly barrierHeld: () => boolean
  readonly now?: () => Date
  /** Pause when nothing is due, between lease attempts, and between proofs of the lease. */
  readonly idleMs?: number
  readonly retryMs?: number
  readonly keepaliveMs?: number
  readonly report?: (message: string) => void
}

export interface Dispatcher {
  /** The epoch this executor leads with, or `undefined` while it does not lead. */
  readonly epoch: () => number | undefined
  /** Stops taking work, aborts the call in flight, closes the connection (the lock goes with it). Idempotent. */
  readonly stop: () => Promise<void>
}

/**
 * The one executor of e-Factura submissions. It never starts anything: it
 * moves the submissions users queued, polls, downloads and refreshes tokens.
 * Exclusivity is the session lock on its own connection; every write is fenced
 * by the epoch it bumped on taking the lock. The lock, the connection or the
 * barrier lost, or any of its transactions failing: the step in flight is
 * interrupted (its HTTP call aborted), the connection closed, and it starts
 * over as a candidate. Taking the lead again runs the recovery first.
 */
export const startDispatcher = (options: DispatcherOptions): Dispatcher => {
  const now = options.now ?? (() => new Date())
  const [idleMs, retryMs, keepaliveMs] = [options.idleMs ?? 5_000, options.retryMs ?? 5_000, options.keepaliveMs ?? 2_000]
  const { environment } = options.anaf
  const gateway = createSubmissionGateway(environment, options.transport)
  const state = { stopped: false, leader: undefined as StepContext | undefined, step: undefined as Fiber.RuntimeFiber<unknown, unknown> | undefined }
  let chain: Promise<void> = Promise.resolve()
  let timer: NodeJS.Timeout | undefined
  let probing = false

  const lose = async (reason: string): Promise<void> => {
    const { leader, step } = state
    if (leader === undefined) return
    state.leader = undefined
    options.report?.(`e-Factura dispatcher: ${reason}`)
    if (step !== undefined) await Effect.runPromise(Fiber.interrupt(step))
    await leader.lease.end()
  }

  /** Takes the lock and the epoch, then recovers; the refusal memory of the credentials lives as long as the lease. */
  const lead = async (): Promise<StepContext | undefined> => {
    const lease: DispatcherLease | undefined = await acquireLease(options.settings, now(), (reason) => { void lose(reason) })
    if (lease === undefined) return undefined
    const credentials = dispatcherCredentials(connectionHost(lease.pool, options.anaf, options.transport, now), now)
    state.leader = { lease, gateway, credentials, environment, now }
    const recovered = await Effect.runPromiseExit(lease.run((client) => dispatchStore(client, now()).recover(environment)))
    if (Exit.isFailure(recovered)) {
      await lose("the recovery failed")
      return undefined
    }
    options.report?.(`e-Factura dispatcher: leading with epoch ${String(lease.epoch)}`)
    return state.leader
  }

  const turn = async (): Promise<number> => {
    if (!options.barrierHeld()) {
      await lose("the maintenance barrier is not held")
      return retryMs
    }
    const leader = state.leader ?? await lead()
    if (leader === undefined || state.stopped) return retryMs
    const step = Effect.runFork(dispatchOne(leader))
    state.step = step
    const exit = await Effect.runPromise(Fiber.await(step))
    state.step = undefined
    if (Exit.isSuccess(exit)) return exit.value === "idle" ? idleMs : 0
    await lose(Exit.isInterrupted(exit) ? "the step was interrupted" : "a step failed; starting over")
    return retryMs
  }

  const schedule = (delay: number): void => {
    if (state.stopped) return
    timer = setTimeout(() => {
      timer = undefined
      chain = chain.then(turn).catch(() => retryMs).then(schedule)
    }, delay)
    timer.unref()
  }

  const keepalive = setInterval(() => {
    const { leader } = state
    if (leader === undefined || probing) return
    if (!options.barrierHeld()) return void lose("the maintenance barrier is not held")
    probing = true
    void leader.lease.verify().catch(() => false)
      .then((held) => held || state.leader !== leader ? undefined : lose("the dispatcher lock or epoch moved on"))
      .finally(() => { probing = false })
  }, keepaliveMs)
  keepalive.unref()

  schedule(0)
  let stopping: Promise<void> | undefined
  return {
    epoch: () => state.leader?.lease.epoch,
    stop: () => stopping ??= (async () => {
      state.stopped = true
      clearInterval(keepalive)
      if (timer !== undefined) clearTimeout(timer)
      await lose("stopping")
      // A lease taken while stopping (the turn was already acquiring) is given up too.
      await chain.catch(() => undefined)
      await lose("stopping")
    })(),
  }
}
