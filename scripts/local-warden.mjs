import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

const parsed = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    domain: { type: "string", default: "invoice.test" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
})

const help = `Prepare local Warden routing for QWBE Invoicing.

Usage:
  pnpm local:setup                         # dry-run
  pnpm local:setup --apply                 # start Warden and sign invoice.test
  pnpm local:setup --domain name.test      # plan another .test domain
  pnpm local:setup --apply --json

The command never edits /etc/hosts. Warden DNS resolves .test on microq; add the
microq LAN address and selected domain to the laptop hosts file separately.
Exit codes: 0 success, 2 invalid input, 1 execution failure.
`

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: parsed.values.json ? "pipe" : "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`)
}

try {
  if (parsed.values.help) {
    console.log(help)
  } else {
    const domain = parsed.values.domain.toLowerCase()
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?[.]test$/.test(domain)) {
      console.error("domain must be a single valid .test hostname")
      process.exitCode = 2
    } else {
      const certificate = join(homedir(), ".warden", "ssl", "certs", `${domain}.crt.pem`)
      const dynamicConfig = join(homedir(), ".warden", "etc", "traefik", "dynamic.yml")
      const certificateExists = existsSync(certificate)
      const certificateConfigured = existsSync(dynamicConfig)
        && readFileSync(dynamicConfig, "utf8").includes(`/warden/${domain}.crt.pem`)
      const reloadNeeded = !certificateExists || !certificateConfigured
      const report = {
        domain,
        apply: parsed.values.apply,
        certificate,
        certificateExists,
        certificateConfigured,
        operations: [
          "warden svc up",
          ...(!certificateExists ? [`warden sign-certificate ${domain}`] : []),
          ...(reloadNeeded ? ["warden svc up traefik", "warden svc restart traefik"] : []),
        ],
      }

      if (parsed.values.apply) {
        run("warden", ["svc", "up"])
        if (!certificateExists) run("warden", ["sign-certificate", domain])
        if (reloadNeeded) {
          run("warden", ["svc", "up", "traefik"])
          run("warden", ["svc", "restart", "traefik"])
        }
      }
      if (parsed.values.json) console.log(JSON.stringify(report))
      else if (!parsed.values.apply) console.log(`Dry-run: ${report.operations.join("; ") || "nothing to change"}`)
      else console.log(`Warden routing is ready for https://${domain}`)
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "local Warden setup failed")
  process.exitCode = 1
}
