import type { ProxyConfig } from "./config.ts"
import { forwardToUpstream } from "./proxy.ts"

/**
 * The backend's Swagger page (`GET /api`, generated from the same `HttpApi` contract
 * it serves) brought to the one public origin. The upstream path is fixed: nothing
 * from the request URL reaches it, and the session cookie is checked and forwarded
 * by the same `forwardToUpstream` every other BFF route uses.
 *
 * The proxy keeps only a short list of upstream headers, so the page's own policy is
 * restated here. Copied from standalone/http/api-docs.ts (the `render` headers): the
 * page is self-contained — CSS, spec and bundle inline — so it needs nothing more.
 *
 * shortcut: read-only — "Try it out" calls the contract's `/api/...` paths, which Next
 * does not serve, and writes need the CSRF token; give the spec `servers` or rewrite
 * paths if calls from the page are ever needed.
 */
const API_DOCS_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
  + "font-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"

type Forward = (request: Request, config: ProxyConfig, path: string) => Promise<Response>

const withPolicy = (headers: Headers): Headers => {
  headers.set("content-security-policy", API_DOCS_POLICY)
  headers.set("cache-control", "no-store")
  headers.set("x-content-type-options", "nosniff")
  headers.set("referrer-policy", "no-referrer")
  return headers
}

export const handleApiDocsRequest = async (
  request: Request,
  config: ProxyConfig,
  forward: Forward = forwardToUpstream,
): Promise<Response> => {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: withPolicy(new Headers({ allow: "GET" })) })
  }
  const basePath = config.upstreamBase.pathname === "/" ? "" : config.upstreamBase.pathname
  const response = await forward(request, config, `${basePath}/api`)
  if (response.status === 401) {
    // The backend clears an invalid session cookie on 401; the redirect keeps that.
    const headers = withPolicy(new Headers({ location: "/unlock" }))
    for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie)
    void response.body?.cancel().catch(() => {})
    return new Response(null, { status: 303, headers })
  }
  return new Response(response.body, { status: response.status, headers: withPolicy(new Headers(response.headers)) })
}
