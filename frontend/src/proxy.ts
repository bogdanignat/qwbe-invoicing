import { NextResponse, type NextRequest } from "next/server"

import { createNonce, securityHeaders } from "./lib/security-headers.ts"

export const proxy = (request: NextRequest): NextResponse => {
  const nonce = createNonce()
  const headers = securityHeaders(nonce, process.env.NODE_ENV === "development")
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("content-security-policy", headers["content-security-policy"] ?? "")
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
  return response
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|healthz(?:/|$)).*)"],
}
