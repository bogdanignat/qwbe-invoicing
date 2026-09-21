import "server-only"

import { runtimeProxyConfig } from "../../../../lib/server/config.ts"
import { handleProxyRequest } from "../../../../lib/server/proxy.ts"

const route = (request: Request): Promise<Response> => handleProxyRequest(request, runtimeProxyConfig())

export const GET = route
export const POST = route
export const PUT = route
export const PATCH = route
export const DELETE = route
export const HEAD = route
export const OPTIONS = route
