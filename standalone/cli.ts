import { parseArgs } from "node:util"

export class CliInputError extends Error {
  override readonly name = "CliInputError"
}

export type Command =
  | { readonly name: "help" }
  | { readonly name: "serve" }
  | { readonly name: "doctor"; readonly json: boolean }
  | { readonly name: "migrate"; readonly apply: boolean; readonly confirmProduction: boolean; readonly json: boolean }

const parseCommandUnchecked = (args: ReadonlyArray<string>): Command => {
  const [name = "help", ...rest] = args
  if (name === "help" || name === "--help" || name === "-h") return { name: "help" }
  if (name === "serve") {
    if (rest.length > 0) throw new CliInputError("serve accepts no options")
    return { name: "serve" }
  }
  if (name === "doctor") {
    const parsed = parseArgs({ args: rest, options: { json: { type: "boolean", default: false } }, strict: true })
    return { name: "doctor", json: parsed.values.json }
  }
  if (name === "migrate") {
    const parsed = parseArgs({
      args: rest,
      options: {
        apply: { type: "boolean", default: false },
        "confirm-production": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      strict: true,
    })
    return {
      name: "migrate",
      apply: parsed.values.apply,
      confirmProduction: parsed.values["confirm-production"],
      json: parsed.values.json,
    }
  }
  throw new CliInputError(`unknown command: ${name}`)
}

export const parseCommand = (args: ReadonlyArray<string>): Command => {
  try {
    return parseCommandUnchecked(args)
  } catch (error) {
    if (error instanceof CliInputError) throw error
    throw new CliInputError(error instanceof Error ? error.message : "invalid command input")
  }
}

export const helpText = `QWBE Invoicing operational CLI

Usage:
  qwbe-invoicing serve
  qwbe-invoicing doctor [--json]
  qwbe-invoicing migrate [--apply] [--confirm-production] [--json]

migrate is a dry-run by default. --apply writes pending schema migrations.
Outside development, --apply also requires --confirm-production.
Exit codes: 0 success, 2 invalid input or guard refusal, 1 execution failure.
`
