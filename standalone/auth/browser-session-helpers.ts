import { createHash, timingSafeEqual } from "node:crypto"

export const cookieName = "qwbe_session"
export const sessionIdPattern = /^[A-Za-z0-9_-]{43}$/

export const sameValue = (actual: string, expected: string): boolean => {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export const sameOrigin = (origin: string | undefined, host: string | undefined): boolean => {
  if (origin === undefined || host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host
  } catch {
    return false
  }
}

export const secureOrigin = (origin: string | undefined): boolean => {
  try {
    return origin !== undefined && new URL(origin).protocol === "https:"
  } catch {
    return false
  }
}

export const cookieValue = (header: string | undefined): string | undefined => {
  if (header === undefined) return undefined
  let found: string | undefined
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=")
    if (name !== cookieName) continue
    if (found !== undefined) return undefined
    found = value.join("=") || undefined
  }
  return found
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

export const cookieAttributes = (secure: boolean): string =>
  `Path=/api; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`
