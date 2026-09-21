import { ApiFailure } from "./api-errors.ts"
import { decodeAuthenticatedSession, decodeLoggedOutSession, type AuthenticatedSession } from "./api-contracts.ts"
import type { BrowserTransport } from "./browser-transport.ts"

const decode = (input: unknown, status = 200): AuthenticatedSession => {
  try {
    return decodeAuthenticatedSession(input)
  } catch (cause) {
    throw new ApiFailure({
      message: cause instanceof Error ? cause.message : "Forma sesiunii este invalidă.",
      status,
    })
  }
}

export interface SessionClient {
  readonly restore: (signal: AbortSignal) => Promise<AuthenticatedSession>
  readonly login: (token: string, signal: AbortSignal) => Promise<AuthenticatedSession>
  readonly logout: (csrfToken: string, signal: AbortSignal) => Promise<void>
}

export const createSessionClient = (transport: BrowserTransport): SessionClient => ({
  restore: async (signal) => decode(await transport.json("/api/session", { signal })),
  login: async (token, signal) => decode(await transport.json("/api/session", {
    method: "POST",
    body: { token: token.trim() },
    signal,
    unauthorized: "ignore",
  })),
  logout: async (csrfToken, signal) => {
    const body = await transport.json("/api/session", { method: "DELETE", csrfToken, signal, unauthorized: "ignore" })
    try {
      decodeLoggedOutSession(body)
    } catch (cause) {
      throw new ApiFailure({ message: cause instanceof Error ? cause.message : "Forma sesiunii este invalidă.", status: 200 })
    }
  },
})
