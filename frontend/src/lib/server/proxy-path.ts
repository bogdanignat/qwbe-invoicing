const publicPrefix = "/api/qwbe/"

const rawPathAndQuery = (absoluteUrl: string): string | undefined => {
  const scheme = absoluteUrl.indexOf("://")
  if (scheme < 0) return undefined
  const start = absoluteUrl.indexOf("/", scheme + 3)
  if (start < 0) return "/"
  const fragment = absoluteUrl.indexOf("#", start)
  return fragment < 0 ? absoluteUrl.slice(start) : absoluteUrl.slice(start, fragment)
}

const unsafeValue = (value: string): boolean => {
  if (value.split("/").some((part) => part === "." || part === "..") || value.includes("\\")) return true
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

const unsafeSegment = (segment: string): boolean => {
  let value = segment
  for (let pass = 0; pass <= 4; pass += 1) {
    if (unsafeValue(value)) return true
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) return false
      if (pass === 4) return true
      value = decoded
    } catch {
      return pass === 0
    }
  }
  return true
}

export const mapProxyPath = (absoluteUrl: string, upstreamBase: URL): string | undefined => {
  const raw = rawPathAndQuery(absoluteUrl)
  if (raw === undefined) return undefined
  const queryAt = raw.indexOf("?")
  const pathname = queryAt < 0 ? raw : raw.slice(0, queryAt)
  const query = queryAt < 0 ? "" : raw.slice(queryAt)
  if (!pathname.startsWith(publicPrefix)) return undefined
  const suffix = pathname.slice(publicPrefix.length)
  if (suffix.length === 0 || suffix.startsWith("/") || suffix.split("/").some(unsafeSegment)) return undefined
  const basePath = upstreamBase.pathname === "/" ? "" : upstreamBase.pathname
  return `${basePath}/api/${suffix}${query}`
}
