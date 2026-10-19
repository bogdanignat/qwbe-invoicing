import type { Duplex } from "node:stream"

/**
 * The headers every answer of the kernel carries: API JSON, PDFs, the docs page,
 * the redirect to `/unlock`, every refusal and the transport errors Node raises
 * before a request exists. Values from `frontend/src/lib/security-headers.ts`,
 * without the nonce: nothing the kernel serves needs an inline script or style.
 * The docs page is the one exception, and it overrides only the CSP.
 */
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ")

export const securityHeaders: Readonly<Record<string, string>> = {
  "content-security-policy": contentSecurityPolicy,
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
}

const clientErrorStatus = (code: string | undefined): string => {
  if (code === "ERR_HTTP_REQUEST_TIMEOUT") return "408 Request Timeout"
  if (code === "HPE_HEADER_OVERFLOW") return "431 Request Header Fields Too Large"
  return "400 Bad Request"
}

/**
 * Node's `clientError` answer (a request it could not parse, or one that ran past
 * `requestTimeout`) with the same headers. Written only on a socket that has not
 * answered anything yet, exactly as Node's default does, and always closed.
 */
export const answerClientError = (error: Error & { readonly code?: string }, socket: Duplex & { readonly bytesWritten?: number }): void => {
  if (!socket.writable || error.code === "ECONNRESET" || (socket.bytesWritten ?? 0) > 0) {
    socket.destroy()
    return
  }
  const headers = { ...securityHeaders, "cache-control": "no-store", connection: "close", "content-length": "0" }
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join("")
  socket.end(`HTTP/1.1 ${clientErrorStatus(error.code)}\r\n${lines}\r\n`)
}
