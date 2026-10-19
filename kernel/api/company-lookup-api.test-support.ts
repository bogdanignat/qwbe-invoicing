import { randomBytes } from "node:crypto"

import { Effect, Redacted } from "effect"
import type { Pool } from "pg"

import { AuthenticationRequired, invoicingPermissions } from "../../cubes/invoicing/index.ts"
import { companyLookupPermission } from "../../cubes/invoicing/company-lookup/index.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import { fakeTransport, type Sent } from "../company-lookup/transport.test-support.ts"
import { allPlugins, type PluginSelection } from "../plugins.ts"
import { createApiHandler } from "./api.ts"

export const secret = "sk_live_DO_NOT_LEAK_0123wxyz"
const lookup = companyLookupPermission("company-lookup")
const settings = invoicingPermissions("invoicing").manageSettings
/** One bearer token per permission set; the organization is always `org-1`. */
const grants: Readonly<Record<string, ReadonlyArray<string>>> = { all: [lookup, settings], lookup: [lookup], settings: [settings], none: [] }

const authenticate: RequestAuthenticator = (authorization) => ({
  current: Effect.suspend(() => {
    const permissions = grants[authorization?.replace(/^Bearer /u, "") ?? ""]
    return permissions === undefined ? Effect.fail(new AuthenticationRequired())
      : Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions }, organization: { id: "org-1" } })
  }),
})

export interface Reply { readonly status: number; readonly body: Record<string, unknown>; readonly text: string }

/**
 * One API handler for a whole test, as the server holds one: the providers'
 * cache lives across calls. Every outbound request lands in `sent`; `respond`
 * decides the answer. Everything written to stdout/stderr is kept in `logs`.
 */
export const companyLookupRig = (pool: Pool, dataDirectory: string, options: { readonly plugins?: PluginSelection; readonly master?: boolean } = {}) => {
  let respond: (sent: Sent) => Response | Promise<Response> = () => new Response(null, { status: 500 })
  const fake = fakeTransport((sent) => respond(sent))
  const handler = createApiHandler({ authenticate, pool, dataDirectory, plugins: options.plugins ?? allPlugins, transport: fake.transport,
    ...(options.master === false ? {} : { companyLookupKey: Redacted.make(randomBytes(32)) }) })
  const logs: Array<string> = []
  const call = async (method: string, path: string, body?: unknown, token = "all"): Promise<Reply> => {
    const capture = <W extends (...args: never[]) => boolean>(write: W) => ((chunk: unknown, ...rest: never[]) => {
      logs.push(String(chunk))
      return write(...[chunk, ...rest] as never[])
    }) as unknown as W
    const [out, err] = [process.stdout.write.bind(process.stdout), process.stderr.write.bind(process.stderr)]
    process.stdout.write = capture(out)
    process.stderr.write = capture(err)
    try {
      const response = await handler.handle(new Request(`http://qwbe.local/api${path}`, { method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
      const text = await response.text()
      return { status: response.status, text, body: text === "" ? {} : JSON.parse(text) as Record<string, unknown> }
    } finally {
      process.stdout.write = out
      process.stderr.write = err
    }
  }
  return {
    call, logs, sent: fake.sent, dispose: handler.dispose,
    reply: (next: typeof respond) => { respond = next },
  }
}
