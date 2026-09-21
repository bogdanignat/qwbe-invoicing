import "server-only"

import { proxyNotFound } from "../../../lib/server/proxy.ts"

const route = (request: Request): Response => proxyNotFound(request)

export const GET = route
export const POST = route
export const PUT = route
export const PATCH = route
export const DELETE = route
export const HEAD = route
export const OPTIONS = route
