import { randomBytes } from "node:crypto"

import { Effect, Redacted } from "effect"

import {
  DAY_MS, classifyTokenReply, type AnafEnvironment, type AnafGateway, type CifVerdict, type TokenReply,
} from "../../../cubes/invoicing/efactura/connection/index.ts"
import { classifyList } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { sha256 } from "../../auth/browser-session-helpers.ts"
import { send, type Transport } from "../../outbound/send.ts"
import type { AnafClient } from "./config.ts"
import { ANAF_HTTP, ANAF_OAUTH, anafApi } from "./endpoints.ts"

/** A token answer is a few kilobytes; anything past this is not one. */
const TOKEN_BODY_BYTES = 256 * 1024

const unrecognized: TokenReply = { kind: "unrecognized" }

/**
 * ANAF's OAuth client for the connection. The URLs are constants, the client
 * comes from the configuration, and nothing a request carries can point a call
 * elsewhere. The client authenticates with Basic; the secret, the code and the
 * tokens go only into headers and bodies, never into a URL, an error or a log.
 */
export const createAnafGateway = (client: AnafClient, environment: AnafEnvironment, transport: Transport): AnafGateway => {
  const basic = `Basic ${Buffer.from(`${client.clientId}:${Redacted.value(client.clientSecret)}`).toString("base64")}`
  const options = (maxBodyBytes: number) => ({ transport, timeoutMs: ANAF_HTTP.timeoutMs, maxBodyBytes, decode: "utf8" as const })
  const post = (url: string, form: Readonly<Record<string, string>>) => send(options(TOKEN_BODY_BYTES), url, {
    method: "POST",
    headers: { authorization: basic, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  })
  const token = (form: Readonly<Record<string, string>>): Effect.Effect<TokenReply> => post(ANAF_OAUTH.token, form).pipe(
    Effect.map((reply) => classifyTokenReply(reply.status, reply.body)),
    Effect.orElseSucceed(() => unrecognized))

  const verifyCif = (accessToken: Redacted.Redacted, cif: string, at: Date): Effect.Effect<CifVerdict> => {
    const url = anafApi(environment).list({ cif, startTime: at.getTime() - DAY_MS, endTime: at.getTime(), page: 1 })
    return send(options(ANAF_HTTP.maxBodyBytes), url, { headers: { authorization: `Bearer ${Redacted.value(accessToken)}` } }).pipe(
      Effect.map((reply) => classifyList({ status: reply.status, retryAfter: reply.headers.get("retry-after"), body: reply.body })),
      Effect.map((listed): CifVerdict => listed.kind === "messages" ? "granted" : listed.kind === "no_right" ? "no_right" : "failed"),
      Effect.orElseSucceed((): CifVerdict => "failed"))
  }

  return {
    authorizeUrl: `${ANAF_OAUTH.authorize}?${new URLSearchParams({
      response_type: "code", client_id: client.clientId, redirect_uri: client.redirectUri, token_content_type: "jwt",
    }).toString()}`,
    newNonce: Effect.sync(() => Redacted.make(randomBytes(32).toString("base64url"))),
    nonceHash: (nonce) => sha256(Redacted.value(nonce)),
    exchangeCode: (code) => token({
      grant_type: "authorization_code", code: Redacted.value(code), redirect_uri: client.redirectUri, token_content_type: "jwt",
    }),
    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: Redacted.value(refreshToken), token_content_type: "jwt" }),
    revoke: (refreshToken) => Effect.ignore(post(ANAF_OAUTH.revoke, { token: Redacted.value(refreshToken), token_type_hint: "refresh_token" })),
    verifyCif,
  }
}
