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
  | { readonly name: "backup-inspect"; readonly input: string; readonly json: boolean }

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
  if (name === "backup-inspect") {
    const parsed = parseArgs({
      args: rest,
      options: { input: { type: "string" }, json: { type: "boolean", default: false } },
      strict: true,
    })
    const input = parsed.values.input?.trim() ?? ""
    if (input.length === 0) throw new CliInputError("backup-inspect requires --input <path> (.tar.gz or directory)")
    return { name: "backup-inspect", input, json: parsed.values.json }
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
