import { Redacted } from "effect"

/**
 * The answer of ANAF's OAuth `token` endpoint, for both the code exchange and
 * the refresh. Only a complete pair is a grant; a refused grant is told apart
 * from everything else because it is the one answer that means "reconnect".
 * Nothing of the body travels on besides the two tokens, already redacted.
 */
export interface TokenGrant {
  readonly accessToken: Redacted.Redacted
  readonly refreshToken: Redacted.Redacted
  readonly accessExpiresInSeconds: number
}

export type TokenReply =
  | { readonly kind: "granted"; readonly grant: TokenGrant }
  /** `invalid_grant`: the code or the refresh token is no longer accepted. */
  | { readonly kind: "invalid_grant" }
  /** 401/403: the client itself (id or secret) was refused. */
  | { readonly kind: "client_refused" }
  | { readonly kind: "unrecognized" }

const MAX_TOKEN_LENGTH = 16 * 1024

const jsonObject = (body: string): Readonly<Record<string, unknown>> | undefined => {
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

const token = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH && /^[\x21-\x7e]+$/u.test(value)

export const classifyTokenReply = (status: number, body: string): TokenReply => {
  if (status === 401 || status === 403) return { kind: "client_refused" }
  const answer = jsonObject(body)
  if (answer === undefined) return { kind: "unrecognized" }
  if (status === 400 && answer.error === "invalid_grant") return { kind: "invalid_grant" }
  const { access_token: access, refresh_token: refresh, expires_in: expiresIn } = answer
  if (status !== 200 || !token(access) || !token(refresh) || typeof expiresIn !== "number"
    || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) return { kind: "unrecognized" }
  return { kind: "granted", grant: { accessToken: Redacted.make(access), refreshToken: Redacted.make(refresh), accessExpiresInSeconds: expiresIn } }
}
