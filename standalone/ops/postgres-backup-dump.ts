import { spawn } from "node:child_process"

import type { PostgresSettings } from "../storage/postgres-pool.ts"
import { redactSecrets } from "../storage/postgres-errors.ts"

/**
 * `pg_dump` and `psql`, run as bounded child processes.
 *
 * The password rule, in full. `PGPASSWORD` is placed in the child's own
 * environment object and nowhere else: `process.env` is never written, the value
 * never becomes an argument (argv is world-readable through `/proc`), and no
 * caller is given a way to log the environment. The child's environment is built
 * from scratch rather than inherited, so nothing else from this process leaks
 * into a tool that writes diagnostics.
 *
 * Output is captured, bounded and redacted on every path — success and failure
 * alike. `redactSecrets` handles the shapes a connection error carries, and the
 * password's own literal is removed on top of it, because a server message can
 * quote the string it was handed.
 *
 * Every run is asynchronous and has a deadline. A synchronous `spawnSync` would
 * hold the event loop for the whole dump while the maintenance lock is held, so
 * nothing else — not a signal handler, not the pool's error listener — could run.
 */

const outputCap = 64 * 1024

export class ToolFailure extends Error {
  override readonly name = "ToolFailure"
}

interface RunOptions {
  readonly password: string
  readonly timeoutMillis: number
}

/**
 * A streaming redactor, and the reason it is not a one-liner.
 *
 * The naive order — accumulate, cap at 64 KiB, then remove the secret — can leave a
 * prefix of the password in the message: if the literal straddles the point where
 * the output was cut, the second half is gone and there is nothing left for a
 * `split` to match. The cut is therefore never allowed to fall inside a secret:
 * every chunk is joined to a carry-over window at least as long as the password,
 * the secret is removed from the join, and only the part that can no longer be
 * completed by a later chunk is released. The cap is applied last, to text the
 * password has already been removed from.
 */
export const createRedactor = (password: string, cap: number = outputCap): {
  readonly feed: (chunk: string) => void
  readonly text: () => string
} => {
  const strip = (text: string): string =>
    password.length === 0 ? text : text.split(password).join("[redacted]")
  const window = Math.max(0, password.length - 1)
  let released = ""
  let carry = ""
  return {
    feed: (chunk: string): void => {
      const cleaned = strip(carry + chunk)
      const keep = Math.min(window, cleaned.length)
      carry = cleaned.slice(cleaned.length - keep)
      if (released.length < cap) released += cleaned.slice(0, cleaned.length - keep)
    },
    text: (): string => redactSecrets(strip(released + carry)).slice(0, cap),
  }
}

const scrub = (text: string, password: string): string => {
  const redactor = createRedactor(password)
  redactor.feed(text)
  return redactor.text()
}

const run = async (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions,
): Promise<string> => {
  const environment: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    LC_ALL: "C",
    PGCONNECT_TIMEOUT: "10",
  }
  if (options.password.length > 0) environment["PGPASSWORD"] = options.password
  return new Promise<string>((settle, fail) => {
    const child = spawn(command, [...args], { env: environment, stdio: ["ignore", "pipe", "pipe"] })
    const out = createRedactor(options.password)
    const err = createRedactor(options.password)
    // The deadline is reported as a deadline. An OOM kill, a `docker stop` and a
    // ten-minute dump would otherwise all read `signal SIGKILL`, and the triage of
    // a failed restore could not separate "too long" from "killed from outside".
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      child.kill("SIGKILL")
    }, options.timeoutMillis)
    timer.unref()
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { out.feed(chunk) })
    child.stderr.on("data", (chunk: string) => { err.feed(chunk) })
    child.on("error", (error: Error) => {
      clearTimeout(timer)
      fail(new ToolFailure(`${command} could not start: ${scrub(error.message, options.password)}`))
    })
    child.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(timer)
      if (code === 0) {
        settle(out.text())
        return
      }
      if (expired) {
        fail(new ToolFailure(
          `${command} exceeded its ${String(options.timeoutMillis)} ms deadline and was killed`,
        ))
        return
      }
      const reason = signal === null ? `exit ${String(code)}` : `signal ${signal}`
      fail(new ToolFailure(`${command} failed (${reason}): ${err.text() || out.text()}`))
    })
  })
}

const majorOf = (version: string): number => Number(/(\d+)\.\d+/u.exec(version)?.[1] ?? "0")

/**
 * The client major, read from the tools themselves rather than from the image's
 * package pin. Alpine 3.24 also carries `postgresql17-client` and
 * `postgresql18-client`, so "a `pg_dump` is on PATH" is not the question: a 17
 * client against a 16 server produces a dump this step did not verify.
 */
export const dumpClientVersions = async (): Promise<{ readonly dump: string; readonly restore: string }> => {
  const options: RunOptions = { password: "", timeoutMillis: 10_000 }
  const dump = (await run("pg_dump", ["--version"], options)).trim()
  const restore = (await run("psql", ["--version"], options)).trim()
  for (const [tool, version] of [["pg_dump", dump], ["psql", restore]] as const) {
    if (majorOf(version) !== 16) throw new ToolFailure(`${tool} must be major 16, found: ${version}`)
  }
  return { dump, restore }
}

/**
 * `--dbname` accepts a full connection string; the `pg` pool does not.
 *
 * A database name containing `=` or `://` is conninfo to `pg_dump` and `psql` —
 * host, port and user can all be overridden inside it — while `postgres-pool.ts`
 * treats the same string as a plain name. The guards would then be read on one
 * server while the dump is taken from, or the restore written to, another. Every
 * value handed to a tool is therefore required to be a plain token first; that the
 * checked target IS the written target is asserted separately, on the locked
 * connection, by `assertTargetMatches`.
 */
const plainValue = (field: string, value: string): string => {
  if (value.length === 0) throw new ToolFailure(`${field} is empty`)
  if (value.length > 128) throw new ToolFailure(`${field} is too long`)
  if (/[=\s]/u.test(value) || value.includes("://") || value.startsWith("-")) {
    throw new ToolFailure(`${field} is not a plain value and could be read as a connection string`)
  }
  return value
}

const connection = (settings: PostgresSettings): ReadonlyArray<string> => [
  "--host", plainValue("host", settings.host),
  "--port", String(settings.port),
  "--username", plainValue("user", settings.user),
  "--dbname", plainValue("database", settings.database),
  "--no-password",
]

/** The table whose rows are excluded while its definition is kept. */
export const excludedTableData = ["public.browser_sessions"] as const

/**
 * Plain format, argued. The alternative is `--format=custom`, whose archive
 * version is a second compatibility surface between the writer and
 * `pg_restore`, and which permits a partial restore. Plain SQL restored through
 * `psql --single-transaction -v ON_ERROR_STOP=1` is all-or-nothing on the
 * server, is checksummed and compressed by the archive this step builds anyway,
 * and lets a dry run read the whole artifact without `pg_restore` ever naming the
 * target database.
 *
 * `--schema=public` is deliberately NOT passed, and that is a defect this step hit
 * rather than reasoned about: with it, `pg_dump` 16 emits `CREATE SCHEMA "public";`
 * and the restore fails on a fresh database with `ERROR: schema "public" already
 * exists`. Restricting the dump by hand would mean either editing the SQL or
 * dropping a schema the restore has no mandate to touch, so the scope is asserted
 * on the source instead: `assertSinglePublicSchema` refuses a backup of a database
 * that has any other user schema, which makes the whole-database dump and the
 * `public`-only dump the same artifact. `--exclude-table-data` drops exactly the rows of
 * `public.browser_sessions` and keeps its definition, so the restored schema does
 * not drift and `migrate` and `doctor` still recognise it.
 */
export const dumpDatabase = async (
  settings: PostgresSettings,
  target: string,
  timeoutMillis: number,
): Promise<void> => {
  await run("pg_dump", [
    ...connection(settings),
    "--format=plain",
    "--no-owner",
    "--no-privileges",
    "--encoding=UTF8",
    "--quote-all-identifiers",
    ...excludedTableData.map((table) => `--exclude-table-data=${table}`),
    `--file=${target}`,
  ], { password: settings.password, timeoutMillis })
}

export const restoreDatabase = async (
  settings: PostgresSettings,
  dump: string,
  timeoutMillis: number,
): Promise<void> => {
  await run("psql", [
    ...connection(settings),
    "--no-psqlrc",
    "--quiet",
    "--single-transaction",
    "--set=ON_ERROR_STOP=1",
    `--file=${dump}`,
  ], { password: settings.password, timeoutMillis })
}
