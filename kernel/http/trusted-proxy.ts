import { BlockList, isIP } from "node:net"

import { normalizedAddress } from "../auth/login-throttle.ts"

/**
 * `QWBE_TRUSTED_PROXY`: the reverse proxies whose `X-Forwarded-For` the kernel
 * believes, as comma-separated addresses or CIDR ranges (`10.0.0.5`,
 * `172.18.0.0/16`, `fd00::/8`). Absent or empty trusts nothing, and then the
 * socket peer is the client. A malformed entry, or a range that trusts every
 * address (`/0`), stops the application at startup.
 */
export interface TrustedProxies {
  readonly trusts: (address: string) => boolean
}

const entryError = (entry: string): Error =>
  new Error(`QWBE_TRUSTED_PROXY entries must be IP addresses or CIDR ranges narrower than /0: ${entry}`)

export const parseTrustedProxies = (value: string | undefined): TrustedProxies => {
  const list = new BlockList()
  const entries = (value ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  for (const entry of entries) {
    const [raw = "", prefix, ...rest] = entry.split("/")
    const address = normalizedAddress(raw)
    if (address === undefined || rest.length > 0) throw entryError(entry)
    const family = isIP(address) === 4 ? "ipv4" : "ipv6"
    if (prefix === undefined) {
      list.addAddress(address, family)
      continue
    }
    const bits = Number(prefix)
    if (!/^\d+$/u.test(prefix) || bits < 1 || bits > (family === "ipv4" ? 32 : 128)) throw entryError(entry)
    list.addSubnet(address, bits, family)
  }
  return {
    trusts: (candidate) => {
      const address = normalizedAddress(candidate)
      if (address === undefined) return false
      return list.check(address, isIP(address) === 4 ? "ipv4" : "ipv6")
    },
  }
}
