import { readFileSync } from "node:fs"

interface StaticAssetDescriptor {
  readonly relativePath: string
  readonly contentType: string
  readonly cacheControl: string
}
interface StaticAsset extends Omit<StaticAssetDescriptor, "relativePath"> { readonly body: Uint8Array }
export interface StaticUiResponse {
  readonly status: number
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string>>
}

const html: StaticAssetDescriptor = { relativePath: "./ui-dist/index.html", contentType: "text/html; charset=utf-8", cacheControl: "no-store" }
const descriptors = new Map<string, StaticAssetDescriptor>([
  ["/", html], ["/app", html],
  ["/assets/app.js", { relativePath: "./ui-dist/assets/app.js", contentType: "text/javascript; charset=utf-8", cacheControl: "no-cache" }],
  ["/assets/app.css", { relativePath: "./ui-dist/assets/app.css", contentType: "text/css; charset=utf-8", cacheControl: "no-cache" }],
])
const uiRoutePatterns = [
  /^\/unlock$/,
  /^\/customers$/,
  /^\/products$/,
  /^\/settings$/,
  /^\/invoices(?:\/new|\/[^/]+)?$/,
  /^\/proformas(?:\/[^/]+)?$/,
  /^\/drafts\/[^/]+$/,
] as const
const cache = new Map<string, StaticAsset>()

const load = (descriptor: StaticAssetDescriptor): StaticAsset | undefined => {
  const cached = cache.get(descriptor.relativePath)
  if (cached !== undefined) return cached
  try {
    const asset = { body: readFileSync(new URL(descriptor.relativePath, import.meta.url)), contentType: descriptor.contentType, cacheControl: descriptor.cacheControl }
    cache.set(descriptor.relativePath, asset)
    return asset
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

const securityHeaders = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const

const missingBundle = (method: string | undefined): StaticUiResponse => {
  const body = new TextEncoder().encode("UI bundle missing. Run pnpm build:ui before starting the standalone host.")
  return { status: 503, body: method === "HEAD" ? new Uint8Array() : body, headers: { ...securityHeaders, "cache-control": "no-store", "content-length": String(body.length), "content-type": "text/plain; charset=utf-8" } }
}

export const staticUiResponse = (method: string | undefined, path: string | undefined): StaticUiResponse | undefined => {
  if (path === undefined) return undefined
  const descriptor = descriptors.get(path) ?? (uiRoutePatterns.some((pattern) => pattern.test(path)) ? html : undefined)
  if (descriptor === undefined) return undefined
  if (method !== "GET" && method !== "HEAD") return { status: 405, body: new Uint8Array(), headers: { ...securityHeaders, allow: "GET, HEAD", "cache-control": "no-store" } }
  const asset = load(descriptor)
  if (asset === undefined) return missingBundle(method)
  return {
    status: 200,
    body: method === "HEAD" ? new Uint8Array() : asset.body,
    headers: { ...securityHeaders, "cache-control": asset.cacheControl, "content-length": String(asset.body.length), "content-type": asset.contentType },
  }
}
