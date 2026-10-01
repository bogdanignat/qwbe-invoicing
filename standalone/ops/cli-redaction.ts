import { redactSecrets } from "../storage/postgres-errors.ts"

/**
 * The CLI's redactor: the pattern-based one from `postgres-errors.ts`, plus the
 * literal secret this process actually read.
 *
 * `redactSecrets` catches `password=…` and `postgres://user:…@host`, which is
 * what a driver error looks like. It cannot catch a password that appears on its
 * own — a `pg_dump` stderr line, a wrapped error that interpolated the value, a
 * message built by a library that quotes the credential alone — so the literal
 * is removed too. Nothing is ever compared against an empty secret, which would
 * replace every empty string in the message.
 */
export const cliRedactor = (secret: string) => (text: string): string => {
  const patterned = redactSecrets(text)
  return secret.length === 0 ? patterned : patterned.replaceAll(secret, "[redacted]")
}

/** The message of an unknown failure, redacted, including a wrapped cause chain. */
export const failureMessage = (redact: (text: string) => string, error: unknown): string => {
  if (!(error instanceof Error)) return "unknown execution failure"
  const causes: Array<string> = [error.message]
  let cause: unknown = error.cause
  // Bounded: a cyclic or absurdly deep chain must not turn a diagnostic into a
  // hang, and three links are already more than an operator reads.
  for (let depth = 0; depth < 3 && cause instanceof Error; depth += 1) {
    causes.push(cause.message)
    cause = cause.cause
  }
  return redact(causes.join(": "))
}
