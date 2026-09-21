export interface ProxyConfig {
  readonly frontendOrigin: URL
  readonly upstreamBase: URL
  readonly timeoutMs: number
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

const required = (environment: RuntimeEnvironment, name: string): string => {
  const value = environment[name]
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

const httpUrl = (value: string, name: string): URL => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTP URL`)
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${name} must be an absolute HTTP URL without userinfo`)
  }
  return parsed
}

export const decodeProxyConfig = (environment: RuntimeEnvironment): ProxyConfig => {
  const frontendValue = required(environment, "FRONTEND_ORIGIN")
  const frontendOrigin = httpUrl(frontendValue, "FRONTEND_ORIGIN")
  if (frontendValue !== frontendOrigin.origin) {
    throw new Error("FRONTEND_ORIGIN must be a canonical origin")
  }

  const upstreamValue = required(environment, "INVOICING_API_URL")
  const upstreamBase = httpUrl(upstreamValue, "INVOICING_API_URL")
  if (upstreamValue.includes("?") || upstreamValue.includes("#")) {
    throw new Error("INVOICING_API_URL must not contain a query or fragment")
  }
  upstreamBase.pathname = upstreamBase.pathname.replace(/\/+$/u, "") || "/"

  return { frontendOrigin, upstreamBase, timeoutMs: 30_000 }
}

export const runtimeProxyConfig = (): ProxyConfig => decodeProxyConfig(process.env)
