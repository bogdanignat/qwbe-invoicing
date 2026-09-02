import { HttpApi } from "@effect/platform"

import { applicationHttpApi, type OperationName } from "./http-api.ts"
import { operationNames } from "./http-api.ts"

interface ReflectedRoute {
  readonly method: string
  readonly operationId: OperationName
  readonly path: string
  readonly parameterNames: ReadonlyArray<string>
  readonly pattern: RegExp
  readonly staticSegments: number
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const compile = (method: string, operationId: string, path: string): ReflectedRoute => {
  const parameterNames: Array<string> = []
  const segments = path.split("/")
  const source = segments.map((segment) => {
    if (!segment.startsWith(":")) return escapeRegExp(segment)
    const name = segment.slice(1).replace(/\?$/, "")
    parameterNames.push(name)
    return segment.endsWith("?") ? "([^/]*)?" : "([^/]+)"
  }).join("/")
  return {
    method,
    operationId: operationId as OperationName,
    path,
    parameterNames,
    pattern: new RegExp(`^${source}$`),
    staticSegments: segments.filter((segment) => !segment.startsWith(":" )).length,
  }
}

const reflectedRoutes: Array<ReflectedRoute> = []
const contractKeys = new Set<string>()
const operationIds = new Set<string>()
const knownOperationIds = new Set<string>(operationNames)
HttpApi.reflect(applicationHttpApi, {
  onGroup() {},
  onEndpoint({ endpoint }) {
    const key = `${endpoint.method} ${endpoint.path}`
    if (contractKeys.has(key)) throw new Error(`duplicate HttpApi route contract: ${key}`)
    if (!knownOperationIds.has(endpoint.name)) throw new Error(`unstable HttpApi operation name: ${endpoint.name}`)
    if (operationIds.has(endpoint.name)) throw new Error(`duplicate HttpApi operation name: ${endpoint.name}`)
    contractKeys.add(key)
    operationIds.add(endpoint.name)
    reflectedRoutes.push(compile(endpoint.method, endpoint.name, endpoint.path))
  },
})
if (operationIds.size !== operationNames.length) throw new Error("operationNames does not match the reflected HttpApi contract")
reflectedRoutes.sort((left, right) => right.staticSegments - left.staticSegments || right.path.length - left.path.length)

export const applicationRoutes = reflectedRoutes.map(({ method, operationId, path }) => ({ method, operationId, path }))

export type RouteMatch =
  | { readonly kind: "matched"; readonly operationId: OperationName; readonly pathParams: Readonly<Record<string, string>> }
  | { readonly kind: "method_not_allowed" }
  | { readonly kind: "not_found" }

export const matchApplicationRoute = (method: string, path: string): RouteMatch => {
  let pathMatched = false
  for (const route of reflectedRoutes) {
    const match = route.pattern.exec(path)
    if (match === null) continue
    pathMatched = true
    if (route.method !== method.toUpperCase()) continue
    const pathParams: Record<string, string> = {}
    route.parameterNames.forEach((name, index) => { pathParams[name] = match[index + 1] ?? "" })
    return { kind: "matched", operationId: route.operationId, pathParams }
  }
  return pathMatched ? { kind: "method_not_allowed" } : { kind: "not_found" }
}
