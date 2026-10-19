import { Cause, Effect, Exit } from "effect"

import type { Transport } from "./provider-http.ts"

export interface Sent {
  readonly url: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | undefined
  readonly redirect: RequestInit["redirect"]
}

/** A transport that answers from `reply` and remembers what it was asked; it never opens a socket. */
export const fakeTransport = (reply: (sent: Sent) => Response | Promise<Response>) => {
  const sent: Array<Sent> = []
  const transport: Transport = async (url, init) => {
    const request: Sent = {
      url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : undefined, redirect: init.redirect,
    }
    sent.push(request)
    return reply(request)
  }
  return { transport, sent }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

/** A body that starts and then never ends: only a timeout gets past it. */
export const stalledBody = (): Response => new Response(new ReadableStream({
  start: (controller) => { controller.enqueue(new TextEncoder().encode("{\"found\":")) },
}), { status: 200 })

/** A body larger than the cap, streamed without a content-length. */
export const oversizedBody = (bytes: number): Response => new Response(new ReadableStream({
  start: (controller) => {
    const chunk = new Uint8Array(64 * 1024).fill(32)
    for (let sent = 0; sent < bytes; sent += chunk.byteLength) controller.enqueue(chunk)
    controller.close()
  },
}), { status: 200 })

/** The failure of an effect, with everything a log line could print of it. */
export const failureOf = async <A, E>(effect: Effect.Effect<A, E>) => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const failure = Cause.failureOption(exit.cause)
  if (failure._tag === "None") throw new Error(`expected a typed failure, got ${Cause.pretty(exit.cause)}`)
  return { failure: failure.value, printed: [Cause.pretty(exit.cause), JSON.stringify(failure.value), String(failure.value)].join("\n") }
}
