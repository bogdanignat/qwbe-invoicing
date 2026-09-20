import {
  HttpApiBuilder, HttpApiError, HttpApp, HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse,
} from "@effect/platform"
import { Cause, Chunk, Effect, Option } from "effect"

import { logInternalFailure } from "../failure-log.ts"

const issuePath = (issue: { readonly path: ReadonlyArray<PropertyKey>, readonly message: string }): string => issue.path.length === 0
  ? issue.message : `${issue.path.map(String).join(".")}: ${issue.message}`
const decodeFailure = (failure: HttpApiError.HttpApiDecodeError) => Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const params = new URL(request.url, "http://qwbe.local").searchParams
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) {
    return HttpServerResponse.unsafeJson({ error: "ValidationFailure",
      issues: ["limit and cursor must be supplied at most once"] }, { status: 400 })
  }
  if (["sourceApp", "sourceKind", "sourceId"].some((key) => params.getAll(key).length > 1)) {
    return HttpServerResponse.unsafeJson({ error: "ValidationFailure",
      issues: ["sourceApp, sourceKind, and sourceId must be supplied exactly once and together"] }, { status: 400 })
  }
  return HttpServerResponse.unsafeJson({ error: "ValidationFailure", issues: failure.issues.map(issuePath) }, { status: 400 })
})
const mapDecodeFailures = (app: HttpApp.Default): HttpApp.Default => Effect.catchIf(
  app as Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, HttpServerRequest.HttpServerRequest>,
  (failure): failure is HttpApiError.HttpApiDecodeError => failure instanceof HttpApiError.HttpApiDecodeError,
  decodeFailure,
) as HttpApp.Default
export const failureMiddleware = HttpApiBuilder.middleware(mapDecodeFailures)

export const methodFallbackLayer = HttpApiBuilder.Router.use((router) => Effect.gen(function*() {
  const built = yield* router.router
  const paths = new Map<HttpRouter.PathInput, Set<string>>()
  for (const route of Chunk.toReadonlyArray(built.routes)) {
    const methods = paths.get(route.path) ?? new Set<string>()
    methods.add(route.method)
    paths.set(route.path, methods)
  }
  const fallback = HttpServerResponse.unsafeJson({ error: "method_not_allowed" }, { status: 405 })
  for (const [path, allowed] of paths) {
    if (!allowed.has("GET")) yield* router.get(path, fallback)
    if (!allowed.has("POST")) yield* router.post(path, fallback)
    if (!allowed.has("PUT")) yield* router.put(path, fallback)
    if (!allowed.has("PATCH")) yield* router.patch(path, fallback)
    if (!allowed.has("DELETE")) yield* router.del(path, fallback)
    if (!allowed.has("HEAD")) yield* router.head(path, fallback)
    if (!allowed.has("OPTIONS")) yield* router.options(path, fallback)
  }
  const notFound = HttpServerResponse.unsafeJson({ error: "not_found" }, { status: 404 })
  yield* router.all("/api", notFound)
  yield* router.all("/api/*", notFound)
}))

export const finalMiddleware = (app: HttpApp.Default): HttpApp.Default => Effect.catchAllCause(app, (cause: Cause.Cause<unknown>) => {
  const failure = Cause.failureOption(cause)
  const defect = Cause.dieOption(cause)
  const failureValue = Option.isSome(failure) ? failure.value : undefined
  const defectValue = Option.isSome(defect) ? defect.value : undefined
  const tagged = (value: unknown, tag: string): boolean => typeof value === "object" && value !== null && "_tag" in value && value._tag === tag
  if (failureValue instanceof HttpServerError.RouteNotFound || tagged(failureValue, "RouteNotFound")
    || defectValue instanceof HttpServerError.RouteNotFound || tagged(defectValue, "RouteNotFound")) {
    return Effect.succeed(HttpServerResponse.unsafeJson({ error: "not_found" }, { status: 404 }))
  }
  if (defectValue instanceof HttpServerError.RequestError && defectValue.reason === "Decode"
    || (tagged(defectValue, "RequestError") && typeof defectValue === "object" && defectValue !== null
      && "reason" in defectValue && defectValue.reason === "Decode")) {
    return Effect.succeed(HttpServerResponse.unsafeJson({ error: "invalid_json" }, { status: 400 }))
  }
  logInternalFailure({ kind: "defect", reason: Cause.pretty(cause) })
  return Effect.succeed(HttpServerResponse.unsafeJson({ error: "internal_failure" }, { status: 500 }))
})
