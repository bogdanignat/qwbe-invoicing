import { parseArgs } from "node:util"

export class CliInputError extends Error {
  override readonly name = "CliInputError"
}

export type Command =
  | { readonly name: "help" }
  | { readonly name: "serve" }
  | { readonly name: "doctor"; readonly json: boolean }
  | { readonly name: "migrate"; readonly apply: boolean; readonly confirmProduction: boolean; readonly json: boolean }
  | { readonly name: "artifacts"; readonly apply: boolean; readonly confirmProduction: boolean; readonly json: boolean; readonly limit: number }
  | { readonly name: "backup"; readonly output: string; readonly json: boolean }
  | { readonly name: "restore"; readonly input: string; readonly apply: boolean; readonly confirmProduction: boolean; readonly json: boolean }

const boundedLimit = (value: string | undefined): number => {
  const limit = Number(value ?? "50")
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CliInputError("limit must be an integer between 1 and 100")
  return limit
}

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
  if (name === "artifacts") {
    const parsed = parseArgs({
      args: rest,
      options: {
        apply: { type: "boolean", default: false },
        "confirm-production": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        limit: { type: "string", default: "50" },
      },
      strict: true,
    })
    return {
      name: "artifacts",
      apply: parsed.values.apply,
      confirmProduction: parsed.values["confirm-production"],
      json: parsed.values.json,
      limit: boundedLimit(parsed.values.limit),
    }
  }
  if (name === "backup") {
    const parsed = parseArgs({
      args: rest,
      options: {
        output: { type: "string" },
        json: { type: "boolean", default: false },
      },
      strict: true,
    })
    const output = parsed.values.output?.trim() ?? ""
    if (output.length === 0) throw new CliInputError("backup requires --output <path> (.tar.gz or directory)")
    return { name: "backup", output, json: parsed.values.json }
  }
  if (name === "restore") {
    const parsed = parseArgs({
      args: rest,
      options: {
        input: { type: "string" },
        apply: { type: "boolean", default: false },
        "confirm-production": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      strict: true,
    })
    const input = parsed.values.input?.trim() ?? ""
    if (input.length === 0) throw new CliInputError("restore requires --input <path> (.tar.gz or directory)")
    return {
      name: "restore",
      input,
      apply: parsed.values.apply,
      confirmProduction: parsed.values["confirm-production"],
      json: parsed.values.json,
    }
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
  qwbe-invoicing artifacts [--limit 50] [--apply] [--confirm-production] [--json]
  qwbe-invoicing backup --output <path.tar.gz|dir> [--json]
  qwbe-invoicing restore --input <path.tar.gz|dir> [--apply] [--confirm-production] [--json]

migrate is a dry-run by default. --apply writes pending schema migrations.
artifacts reports issued invoices without PDFs by default. --apply renders at most
--limit invoices; failures are counted and successful items remain committed for a
safe retry. Outside development, either --apply also requires --confirm-production.
backup copies SQLite databases and artifacts to a .tar.gz archive or directory; it is read-only and idempotent.
restore is a dry-run by default. --apply writes files to DATA_DIR; outside development it also requires --confirm-production.
Exit codes: 0 success, 2 invalid input or guard refusal, 1 execution failure.
`
