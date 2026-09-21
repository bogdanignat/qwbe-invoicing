import { createHash } from "node:crypto"
import { isIP } from "node:net"
import { performance } from "node:perf_hooks"

const inactiveLifetimeMs = 15 * 60 * 1_000
const maximumPeers = 10_000
const maximumFailures = 11

export interface SecurityEvent {
  readonly event: "security.login_failed" | "security.login_throttled"
  readonly timestamp: string
  readonly outcome: "failed" | "throttled"
  readonly reason: "invalid_credentials" | "cooldown"
  readonly client_key: string
  readonly failure_count: number
  readonly retry_after_seconds: number
}

export type SecurityLogger = (event: SecurityEvent) => void

interface PeerState {
  readonly failures: number
  readonly nextAttemptAt: number
  lastSeenAt: number
  throttledLogged: boolean
}

export interface LoginThrottle {
  readonly check: (peer: string) => number
  readonly failed: (peer: string) => void
  readonly succeeded: (peer: string) => void
}

// Socket addresses only. Unusable addresses share a fail-closed bucket; forwarded
// headers and caller-controlled credentials never participate in this key.
export const loginPeerKey = (address: string | undefined): string => {
  if (address === undefined) return "peer:unknown"
  const unscoped = address.split("%", 1)[0] ?? ""
  if (isIP(unscoped) === 4) return `peer:${unscoped}`
  if (isIP(unscoped) !== 6) return "peer:unknown"
  const normalized = new URL(`http://[${unscoped}]/`).hostname.slice(1, -1)
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized)
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1] ?? "", 16)
    const low = Number.parseInt(mapped[2] ?? "", 16)
    return `peer:${String(high >>> 8)}.${String(high & 255)}.${String(low >>> 8)}.${String(low & 255)}`
  }
  return `peer:${normalized}`
}

export const createLoginThrottle = ({
  now = Date.now,
  monotonicNow = () => performance.now(),
  logger = (event) => { process.stderr.write(`${JSON.stringify(event)}\n`) },
}: {
  readonly now?: () => number
  readonly monotonicNow?: () => number
  readonly logger?: SecurityLogger
} = {}): LoginThrottle => {
  const peers = new Map<string, PeerState>()
  const lookup = (peer: string, at: number): PeerState | undefined => {
    const state = peers.get(peer)
    if (state === undefined) return undefined
    peers.delete(peer)
    if (at - state.lastSeenAt >= inactiveLifetimeMs) return undefined
    state.lastSeenAt = at
    peers.set(peer, state)
    return state
  }
  const emit = (peer: string, state: PeerState, retryAfter: number, throttled: boolean) => {
    try {
      logger({
        event: throttled ? "security.login_throttled" : "security.login_failed",
        timestamp: new Date(now()).toISOString(),
        outcome: throttled ? "throttled" : "failed",
        reason: throttled ? "cooldown" : "invalid_credentials",
        client_key: createHash("sha256").update(peer).digest("hex").slice(0, 24),
        failure_count: state.failures,
        retry_after_seconds: retryAfter,
      })
    } catch {
      // Telemetry is best-effort; auth state must never depend on the log sink.
    }
  }
  return {
    check: (peer) => {
      const at = monotonicNow()
      const state = lookup(peer, at)
      if (state === undefined || state.nextAttemptAt <= at) return 0
      const retryAfter = Math.min(30, Math.max(1, Math.ceil((state.nextAttemptAt - at) / 1_000)))
      if (!state.throttledLogged) {
        state.throttledLogged = true
        emit(peer, state, retryAfter, true)
      }
      return retryAfter
    },
    failed: (peer) => {
      const at = monotonicNow()
      const previous = lookup(peer, at)
      const failures = Math.min(maximumFailures, (previous?.failures ?? 0) + 1)
      const cooldownSeconds = failures <= 5 ? 0 : Math.min(30, 2 ** (failures - 6))
      const state: PeerState = {
        failures, nextAttemptAt: at + cooldownSeconds * 1_000, lastSeenAt: at, throttledLogged: false,
      }
      peers.set(peer, state)
      // Map order is LRU. Idle entries are removed on lookup; the cap also bounds
      // retained idle state even if its peer never contacts this process again.
      if (peers.size > maximumPeers) {
        const oldest = peers.keys().next()
        if (!oldest.done) peers.delete(oldest.value)
      }
      emit(peer, state, cooldownSeconds, false)
    },
    succeeded: (peer) => { peers.delete(peer) },
  }
}
