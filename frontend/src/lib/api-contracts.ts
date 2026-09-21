const record = (input: unknown): Readonly<Record<string, unknown>> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Forma sesiunii este invalidă.")
  }
  return input as Readonly<Record<string, unknown>>
}

export interface AuthenticatedSession {
  readonly authenticated: true
  readonly csrfToken: string
}

export const decodeAuthenticatedSession = (input: unknown): AuthenticatedSession => {
  const value = record(input)
  if (value.authenticated !== true || typeof value.csrfToken !== "string" || value.csrfToken.length === 0) {
    throw new Error("Forma sesiunii este invalidă.")
  }
  return { authenticated: true, csrfToken: value.csrfToken }
}

export const decodeLoggedOutSession = (input: unknown): void => {
  if (record(input).authenticated !== false) throw new Error("Forma sesiunii este invalidă.")
}
