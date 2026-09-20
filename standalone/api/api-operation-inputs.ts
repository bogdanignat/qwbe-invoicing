import { createHash } from "node:crypto"

import { Effect } from "effect"

import { ValidationFailure, type DocumentSource } from "../../cube/invoicing/index.ts"

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  throw new ValidationFailure({ issues: ["request cannot be fingerprinted"] })
}
export const idempotent = <Input>(key: string, operation: string, input: Input) => Effect.try({
  try: () => {
    if (!/^[\x21-\x7e]{1,255}$/.test(key)) throw new ValidationFailure({
      issues: ["Idempotency-Key header is required and must contain 1-255 visible ASCII characters"],
    })
    return { request: input, idempotency: { key,
      fingerprint: `sha256:${createHash("sha256").update(canonicalJson({ operation, input })).digest("hex")}` } }
  },
  catch: (error) => error instanceof ValidationFailure ? error : new ValidationFailure({ issues: ["request cannot be fingerprinted"] }),
})

interface SourceParams { readonly sourceApp?: string; readonly sourceKind?: string; readonly sourceId?: string }
export const sourceFilter = (params: SourceParams): Effect.Effect<DocumentSource | undefined, ValidationFailure> => {
  const entries = [params.sourceApp, params.sourceKind, params.sourceId] as const
  if (entries.every((value) => value === undefined)) return Effect.succeed(undefined)
  if (entries.some((value) => value === undefined)) return Effect.fail(new ValidationFailure({
    issues: ["sourceApp, sourceKind, and sourceId must be supplied exactly once and together"],
  }))
  return Effect.succeed({ app: entries[0] as string, kind: entries[1] as string, id: entries[2] as string })
}
