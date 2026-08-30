#!/usr/bin/env node
import { accessSync, constants } from "node:fs"

import { CliInputError, helpText, parseCommand, type Command } from "../standalone/cli.ts"
import { runtimeConfig } from "../standalone/config.ts"
import { startServer } from "../standalone/http.ts"
import { applyMigrations, databaseReady, planMigrations } from "../standalone/migrations.ts"

const print = (value: unknown, json: boolean) => {
  console.log(json ? JSON.stringify(value) : value)
}

let command: Command | undefined
try {
  command = parseCommand(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof CliInputError ? error.message : "invalid command input")
  process.exitCode = 2
}

if (command !== undefined) {
  try {
    const config = runtimeConfig()

    if (command.name === "help") print(helpText, false)
    if (command.name === "serve") {
      let acceptingTraffic = true
      const server = startServer(config, () => acceptingTraffic && databaseReady(config.dataDirectory))
      const close = () => {
        if (!acceptingTraffic) return
        acceptingTraffic = false
        const deadline = setTimeout(() => {
          server.closeAllConnections()
          process.exitCode = 1
        }, 10_000)
        server.close(() => {
          clearTimeout(deadline)
          process.exitCode = 0
        })
      }
      process.once("SIGINT", close)
      process.once("SIGTERM", close)
    }
    if (command.name === "doctor") {
      let writable = true
      try {
        accessSync(config.dataDirectory, constants.R_OK | constants.W_OK)
      } catch {
        writable = false
      }
      const report = {
        dataDirectory: config.dataDirectory,
        writable,
        databaseReady: databaseReady(config.dataDirectory),
      }
      print(report, command.json)
      if (!writable || !report.databaseReady) process.exitCode = 1
    }
    if (command.name === "migrate") {
      if (command.apply && config.nodeEnvironment !== "development" && !command.confirmProduction) {
        console.error("migrate --apply outside development requires --confirm-production")
        process.exitCode = 2
      } else {
        const report = command.apply ? applyMigrations(config.dataDirectory) : planMigrations(config.dataDirectory)
        print(report, command.json)
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "unknown execution failure")
    process.exitCode = 1
  }
}
