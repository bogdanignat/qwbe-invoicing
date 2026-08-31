import { readFileSync } from "node:fs"

interface StaticAsset {
  readonly body: Uint8Array
  readonly contentType: string
  readonly cacheControl: string
}

export interface StaticUiResponse {
  readonly status: number
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string>>
}

const load = (relativePath: string, contentType: string, cacheControl: string): StaticAsset => ({
  body: readFileSync(new URL(relativePath, import.meta.url)),
  contentType,
  cacheControl,
})

const html = load("./ui/index.html", "text/html; charset=utf-8", "no-store")
const assets = new Map<string, StaticAsset>([
  ["/", html],
  ["/app", html],
  ["/assets/app.js", load("./ui/app.js", "text/javascript; charset=utf-8", "no-cache")],
  ["/assets/api-client.js", load("./ui/api-client.js", "text/javascript; charset=utf-8", "no-cache")],
  ["/assets/app.css", load("./ui/app.css", "text/css; charset=utf-8", "no-cache")],
])

const securityHeaders = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const

export const staticUiResponse = (method: string | undefined, path: string | undefined): StaticUiResponse | undefined => {
  if (path === undefined) return undefined
  const asset = assets.get(path)
  if (asset === undefined) return undefined
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 405,
      body: new Uint8Array(),
      headers: { ...securityHeaders, allow: "GET, HEAD", "cache-control": "no-store" },
    }
  }
  return {
    status: 200,
    body: method === "HEAD" ? new Uint8Array() : asset.body,
    headers: {
      ...securityHeaders,
      "cache-control": asset.cacheControl,
      "content-length": String(asset.body.length),
      "content-type": asset.contentType,
    },
  }
}
