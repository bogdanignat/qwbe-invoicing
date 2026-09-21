export const createNonce = (randomUUID: () => string = () => crypto.randomUUID()): string =>
  randomUUID().replaceAll("-", "")

export const contentSecurityPolicy = (nonce: string, development: boolean): string => [
  "default-src 'none'",
  `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}`,
  // External CSS uses 'self'; the nonce permits only framework-emitted inline styles.
  `style-src 'self' 'nonce-${nonce}'`,
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ")

export const securityHeaders = (nonce: string, development: boolean): Readonly<Record<string, string>> => ({
  "content-security-policy": contentSecurityPolicy(nonce, development),
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
})
