import { createHash, randomUUID } from "node:crypto"

import {
  HttpApiBuilder, HttpApiError, HttpApp, HttpRouter, HttpServer, HttpServerError, HttpServerRequest, HttpServerResponse,
} from "@effect/platform"
import { Cause, Chunk, Effect, Layer, Option, Redacted, Schema } from "effect"

import {
  ValidationFailure, createInvoicingService, type DocumentSource, type InvoicingFailure, type RequestContext,
} from "../cube/invoicing/index.ts"
import type { DocumentsFailure } from "../cube/invoicing/documents/index.ts"
import { createPaymentsService, type PaymentsFailure } from "../cube/payments/index.ts"
import { createStandaloneArtifactService } from "./artifact-runtime.ts"
import type { RequestAuthenticator } from "./auth.ts"
import { brandingNormalizer } from "./branding-normalizer.ts"
import type { BrowserSession } from "./browser-session.ts"
import { ApiAuthentication, CurrentRequest, CurrentSession, SessionAuthentication, applicationHttpApi } from "./http-api.ts"
import * as S from "./http-schemas.ts"
import { createSqlitePaymentsStore, createSqliteStore } from "./sqlite-store.ts"

export interface ApiRuntime {
  readonly authenticate: RequestAuthenticator
  readonly dataDirectory: string
  readonly now?: () => Date
  readonly browserSession?: BrowserSession
}

type Wire =
  | { readonly error: "AuthenticationRequired" | "OrganizationContextMissing" | "PermissionDenied" | "DocumentsPermissionDenied" }
  | { readonly error: "ValidationFailure"; readonly issues: ReadonlyArray<string> }
  | { readonly error: "ResourceNotFound" | "DocumentNotFound" | "ArtifactConflict" | "PersistenceFailure"
    | "DocumentPersistenceFailure" | "DocumentRenderingFailure" | "internal_failure" }
  | { readonly error: "DomainConflict"; readonly code: string }
type ApiFailure = InvoicingFailure | PaymentsFailure | DocumentsFailure
type WireTag = Wire["error"]
type Allowed<T extends WireTag> = Extract<Wire, { readonly error: T }> | { readonly error: "internal_failure" }

const toWire = (failure: ApiFailure): Wire => {
  switch (failure._tag) {
    case "ValidationFailure": return { error: "ValidationFailure", issues: failure.issues }
    case "DomainConflict": return { error: "DomainConflict", code: failure.code }
    case "RenderingFailure": return { error: "internal_failure" }
    case "AuthenticationRequired":
    case "OrganizationContextMissing":
    case "PermissionDenied":
    case "DocumentsPermissionDenied":
    case "ResourceNotFound":
    case "DocumentNotFound":
    case "ArtifactConflict":
    case "PersistenceFailure":
    case "DocumentPersistenceFailure":
    case "DocumentRenderingFailure": return { error: failure._tag }
  }
}
const only = <T extends WireTag>(allowed: ReadonlyArray<T>) => (failure: ApiFailure): Allowed<T> => {
  const wire = toWire(failure)
  return (allowed as ReadonlyArray<string>).includes(wire.error) ? wire as Allowed<T> : { error: "internal_failure" }
}
type InvoicingBase = "AuthenticationRequired" | "OrganizationContextMissing" | "PermissionDenied" | "PersistenceFailure"
type DocumentsBase = "AuthenticationRequired" | "OrganizationContextMissing" | "DocumentsPermissionDenied"
  | "DocumentPersistenceFailure" | "DocumentRenderingFailure"
const invoicingBase: ReadonlyArray<InvoicingBase> = ["AuthenticationRequired", "OrganizationContextMissing", "PermissionDenied", "PersistenceFailure"]
const documentsBase: ReadonlyArray<DocumentsBase> = ["AuthenticationRequired", "OrganizationContextMissing", "DocumentsPermissionDenied",
  "DocumentPersistenceFailure", "DocumentRenderingFailure"]
const errors = <T extends WireTag = never>(...extra: ReadonlyArray<T>) => only<InvoicingBase | T>([...invoicingBase, ...extra])
const documentErrors = <T extends WireTag = never>(...extra: ReadonlyArray<T>) => only<DocumentsBase | T>([...documentsBase, ...extra])

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  throw new ValidationFailure({ issues: ["request cannot be fingerprinted"] })
}
const idempotent = <Input>(key: string, operation: string, input: Input) => Effect.try({
  try: () => {
    if (!/^[\x21-\x7e]{1,255}$/.test(key)) throw new ValidationFailure({
      issues: ["Idempotency-Key header is required and must contain 1-255 visible ASCII characters"],
    })
    return { request: input, idempotency: { key,
      fingerprint: `sha256:${createHash("sha256").update(canonicalJson({ operation, input })).digest("hex")}` } }
  },
  catch: (error) => error instanceof ValidationFailure ? error : new ValidationFailure({ issues: ["request cannot be fingerprinted"] }),
})

interface SourceParams { readonly sourceApp?: string; readonly sourceKind?: string; readonly sourceId?: string }
const sourceFilter = (params: SourceParams): Effect.Effect<DocumentSource | undefined, ValidationFailure> => {
  const entries = [params.sourceApp, params.sourceKind, params.sourceId] as const
  if (entries.every((value) => value === undefined)) return Effect.succeed(undefined)
  if (entries.some((value) => value === undefined)) return Effect.fail(new ValidationFailure({
    issues: ["sourceApp, sourceKind, and sourceId must be supplied exactly once and together"],
  }))
  return Effect.succeed({ app: entries[0] as string, kind: entries[1] as string, id: entries[2] as string })
}
const pdfResponse = (kind: "invoice" | "proforma", id: string, bytes: Uint8Array, sha256: string) => {
  const filenameId = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || kind
  return HttpServerResponse.uint8Array(bytes, { contentType: "application/pdf", headers: {
    "content-disposition": `attachment; filename="${kind}-${filenameId}.pdf"`, "x-content-type-options": "nosniff",
    etag: `"sha256-${sha256}"`,
  } })
}

const services = (runtime: ApiRuntime, context: RequestContext) => {
  const clock = { now: Effect.sync(runtime.now ?? (() => new Date())) }
  const ids = { next: Effect.sync(randomUUID) }
  const current = { current: Effect.succeed(context) }
  return {
    invoicing: createInvoicingService({ context: current, clock, ids, store: createSqliteStore(runtime.dataDirectory),
      branding: brandingNormalizer, cubeIdentity: "invoicing" }),
    payments: createPaymentsService({ context: current, clock, ids, store: createSqlitePaymentsStore(runtime.dataDirectory), cubeIdentity: "payments" }),
    documents: createStandaloneArtifactService(runtime.dataDirectory, Effect.succeed({
      identity: { id: context.identity.id, permissions: context.identity.permissions }, organization: context.organization,
    })),
  }
}
type Services = ReturnType<typeof services>
type ContextFailure = { readonly error: "AuthenticationRequired" } | { readonly error: "OrganizationContextMissing" }
const principal = (runtime: ApiRuntime, authorization: string): Effect.Effect<RequestContext, ContextFailure> =>
  Effect.mapError(runtime.authenticate(authorization).current, (failure) => ({ error: failure._tag }))

const authenticationLayer = (runtime: ApiRuntime) => Layer.succeed(ApiAuthentication, {
  bearerAuth: (token) => {
    const value = Redacted.value(token)
    return value.length === 0 ? Effect.fail({ error: "AuthenticationRequired" as const }) : principal(runtime, `Bearer ${value}`)
  },
  sessionCookie: (cookie) => Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (request.headers.authorization !== undefined) return yield* Effect.fail({ error: "AuthenticationRequired" as const })
    const value = Redacted.value(cookie)
    const session = runtime.browserSession
    if (session === undefined || value.length === 0) return yield* Effect.fail({ error: "AuthenticationRequired" as const })
    const authorization = session.authorize({ cookie: `qwbe_session=${value}`, method: request.method,
      csrfToken: request.headers["x-csrf-token"], origin: request.headers.origin, host: request.headers.host })
    if (authorization.kind === "forbidden") return yield* Effect.fail({ error: "csrf_validation_failed" as const })
    if (authorization.kind === "unauthorized") return yield* Effect.fail({ error: "AuthenticationRequired" as const })
    return yield* principal(runtime, authorization.authorization)
  }),
})
const sessionAuthenticationLayer = (runtime: ApiRuntime) => Layer.succeed(SessionAuthentication, {
  sessionCookie: (cookie) => {
    const value = Redacted.value(cookie)
    const header = `qwbe_session=${value}`
    const resumed = runtime.browserSession?.resume(header)
    return resumed === undefined || resumed.kind === "unauthorized" || value.length === 0
      ? Effect.fail({ error: "AuthenticationRequired" as const })
      : Effect.succeed({ csrfToken: resumed.csrfToken, cookie: header })
  },
})

const invoicingGroup = (runtime: ApiRuntime) => {
  const use = <A, E>(operation: (value: Services) => Effect.Effect<A, E>) =>
    Effect.flatMap(CurrentRequest, (context) => operation(services(runtime, context)))
  const deleted = { deleted: true } as const
  return HttpApiBuilder.group(applicationHttpApi, "invoicing", (handlers) => handlers
    .handle("getIssuer", () => use((s) => s.invoicing.getIssuer()).pipe(Effect.mapError(errors("ResourceNotFound"))))
    .handle("configureIssuer", ({ payload }) => use((s) => s.invoicing.configureIssuer(payload)).pipe(Effect.mapError(errors("ValidationFailure"))))
    .handle("listDocumentSeries", () => use((s) => s.invoicing.listDocumentSeries()).pipe(Effect.mapError(errors())))
    .handle("addDocumentSeries", ({ payload }) => use((s) => s.invoicing.addDocumentSeries(payload)).pipe(Effect.mapError(errors("ValidationFailure", "DomainConflict"))))
    .handle("listUnitOfMeasures", () => use((s) => s.invoicing.listUnitOfMeasures()).pipe(Effect.mapError(errors())))
    .handle("listVatRegimes", ({ urlParams }) => use((s) => s.invoicing.getVatCatalogue(
      urlParams.countryCode === undefined || urlParams.fiscalIdentifier === undefined ? undefined
        : { countryCode: urlParams.countryCode, fiscalIdentifier: urlParams.fiscalIdentifier },
    )).pipe(Effect.mapError(errors("ValidationFailure"))))
    .handle("listCustomers", ({ urlParams }) => use((s) => s.invoicing.listCustomers(urlParams)).pipe(Effect.mapError(errors("ValidationFailure"))))
    .handle("getCustomer", ({ path }) => use((s) => s.invoicing.getCustomer(path.id)).pipe(Effect.mapError(errors("ResourceNotFound"))))
    .handle("createCustomer", ({ payload }) => use((s) => s.invoicing.createCustomer(payload)).pipe(Effect.mapError(errors("ValidationFailure"))))
    .handle("updateCustomer", ({ path, payload }) => use((s) => s.invoicing.updateCustomer({ id: path.id, ...payload })).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound"))))
    .handle("deleteCustomer", ({ path }) => use((s) => s.invoicing.deleteCustomer(path.id)).pipe(Effect.as(deleted), Effect.mapError(errors("ResourceNotFound", "DomainConflict"))))
    .handle("listProductPresets", ({ urlParams }) => use((s) => s.invoicing.listProductPresets(urlParams)).pipe(Effect.mapError(errors("ValidationFailure"))))
    .handle("createProductPreset", ({ payload }) => use((s) => s.invoicing.createProductPreset(payload)).pipe(Effect.mapError(errors("ValidationFailure"))))
    .handle("updateProductPreset", ({ path, payload }) => use((s) => s.invoicing.updateProductPreset({ id: path.id, ...payload })).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound"))))
    .handle("deleteProductPreset", ({ path }) => use((s) => s.invoicing.deleteProductPreset(path.id)).pipe(Effect.as(deleted), Effect.mapError(errors("ResourceNotFound"))))
    .handle("listDrafts", ({ urlParams }) => sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listDrafts(source, urlParams))), Effect.mapError(errors("ValidationFailure"))))
    .handle("getDraft", ({ path }) => use((s) => s.invoicing.getDraft(path.id)).pipe(Effect.mapError(errors("ResourceNotFound"))))
    .handle("createDraft", ({ payload }) => use((s) => s.invoicing.createDraft(payload)).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound"))))
    .handle("updateDraft", ({ path, payload }) => use((s) => s.invoicing.updateDraft({ draftId: path.id, ...payload })).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("deleteDraft", ({ path }) => use((s) => s.invoicing.deleteDraft(path.id)).pipe(Effect.as(deleted), Effect.mapError(errors("ResourceNotFound", "DomainConflict"))))
    .handle("addDraftLine", ({ path, payload }) => use((s) => s.invoicing.addDraftLine({ draftId: path.draftId, ...payload })).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("updateDraftLine", ({ path, payload }) => use((s) => s.invoicing.updateDraftLine({ draftId: path.draftId, lineId: path.lineId, ...payload })).pipe(Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("deleteDraftLine", ({ path }) => use((s) => s.invoicing.deleteDraftLine(path.draftId, path.lineId)).pipe(Effect.mapError(errors("ResourceNotFound", "DomainConflict"))))
    .handle("issueDraftInvoice", ({ path, headers }) => idempotent(headers["idempotency-key"], "issue_invoice_from_draft", { draftId: path.draftId }).pipe(Effect.flatMap((input) => use((s) => s.invoicing.issueInvoice(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("listPayments", ({ path }) => use((s) => s.payments.listPayments(path.invoiceId)).pipe(Effect.mapError(errors("ResourceNotFound"))))
    .handle("recordPayment", ({ path, payload, headers }) => idempotent(headers["idempotency-key"], "record_payment", { invoiceId: path.invoiceId, ...payload }).pipe(Effect.flatMap((input) => use((s) => s.payments.recordPayment(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("reversePayment", ({ path, payload, headers }) => idempotent(headers["idempotency-key"], "reverse_payment", { invoiceId: path.invoiceId, paymentId: path.paymentId, ...payload }).pipe(Effect.flatMap((input) => use((s) => s.payments.reversePayment(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("createCorrection", ({ path, payload, headers }) => idempotent(headers["idempotency-key"], "create_correction", { originalInvoiceId: path.invoiceId, ...payload }).pipe(Effect.flatMap((input) => use((s) => s.invoicing.createCorrection(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("listCorrections", ({ path, urlParams }) => sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listCorrections(path.invoiceId, source))), Effect.mapError(errors("ValidationFailure"))))
    .handle("getCorrection", ({ path }) => use((s) => s.invoicing.getCorrection(path.id)).pipe(Effect.mapError(errors("ResourceNotFound"))))
    .handle("listIssuedInvoices", ({ urlParams }) => sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listIssuedInvoices(source, urlParams))), Effect.mapError(errors("ValidationFailure"))))
    .handle("issueInvoice", ({ payload, headers }) => idempotent(headers["idempotency-key"], "issue_invoice_direct", payload).pipe(Effect.flatMap((input) => use((s) => s.invoicing.issueInvoice(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("getIssuedInvoice", ({ path }) => use((s) => s.invoicing.getIssuedInvoice(path.id)).pipe(Effect.mapError(errors("ResourceNotFound"))))
    .handle("issueDraftProforma", ({ path, payload, headers }) => idempotent(headers["idempotency-key"], "issue_proforma_from_draft", { draftId: path.draftId, ...payload }).pipe(Effect.flatMap((input) => use((s) => s.invoicing.issueProforma(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("listProformas", ({ urlParams }) => sourceFilter(urlParams).pipe(Effect.flatMap((source) => use((s) => s.invoicing.listProformas(source, urlParams))), Effect.mapError(errors("ValidationFailure"))))
    .handle("issueProforma", ({ payload, headers }) => idempotent(headers["idempotency-key"], "issue_proforma_direct", payload).pipe(Effect.flatMap((input) => use((s) => s.invoicing.issueProforma(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict"))))
    .handle("getProforma", ({ path }) => use((s) => s.invoicing.getProforma(path.id)).pipe(Effect.mapError(errors("ResourceNotFound"))))
    .handle("issueInvoiceFromProforma", ({ path, headers }) => idempotent(headers["idempotency-key"], "issue_invoice_from_proforma", { proformaId: path.id }).pipe(Effect.flatMap((input) => use((s) => s.invoicing.issueInvoiceFromProforma(input))), Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict")))))
}

const documentsGroup = (runtime: ApiRuntime) => {
  const use = <A, E>(operation: (value: Services) => Effect.Effect<A, E>) => Effect.flatMap(CurrentRequest, (context) => operation(services(runtime, context)))
  return HttpApiBuilder.group(applicationHttpApi, "documents", (handlers) => handlers
    .handle("renderInvoicePdf", ({ path }) => use((s) => s.documents.renderInvoice(path.invoiceId)).pipe(Effect.mapError(documentErrors("DocumentNotFound", "ArtifactConflict"))))
    .handleRaw("downloadInvoicePdf", ({ path }) => use((s) => s.documents.downloadInvoice(path.invoiceId)).pipe(Effect.map(({ artifact, bytes }) => pdfResponse("invoice", path.invoiceId, bytes, artifact.sha256)), Effect.mapError(documentErrors("DocumentNotFound"))))
    .handle("renderProformaPdf", ({ path }) => use((s) => s.documents.renderProforma(path.proformaId)).pipe(Effect.mapError(documentErrors("DocumentNotFound", "ArtifactConflict"))))
    .handleRaw("downloadProformaPdf", ({ path }) => use((s) => s.documents.downloadProforma(path.proformaId)).pipe(Effect.map(({ artifact, bytes }) => pdfResponse("proforma", path.proformaId, bytes, artifact.sha256)), Effect.mapError(documentErrors("DocumentNotFound")))))
}

const sessionsGroup = (runtime: ApiRuntime) => HttpApiBuilder.group(applicationHttpApi, "sessions", (handlers) => handlers
  .handle("getSession", () => Effect.map(CurrentSession, ({ csrfToken }) => ({ authenticated: true as const, csrfToken })))
  .handleRaw("createSession", ({ request }) => Effect.gen(function*() {
    const session = runtime.browserSession
    if (session === undefined) return HttpServerResponse.unsafeJson({ error: "not_found" }, { status: 404 })
    const raw = yield* Effect.either(request.json)
    if (raw._tag === "Left") return HttpServerResponse.unsafeJson({ error: "invalid_json" }, { status: 400 })
    const decoded = Schema.decodeUnknownEither(S.LoginInput, { errors: "all" })(raw.right)
    if (decoded._tag === "Left" || decoded.right.token.trim().length === 0) {
      return HttpServerResponse.unsafeJson({ error: "invalid_credentials" }, { status: 400 })
    }
    const login = session.login({ token: decoded.right.token, origin: request.headers.origin, host: request.headers.host })
    if (login.kind === "forbidden") return HttpServerResponse.unsafeJson({ error: "origin_not_allowed" }, { status: 403 })
    if (login.kind === "unauthorized") return HttpServerResponse.unsafeJson({ error: "invalid_credentials" }, {
      status: 401, headers: { "set-cookie": session.clearCookie },
    })
    return HttpServerResponse.unsafeJson({ authenticated: true, csrfToken: login.csrfToken }, { headers: { "set-cookie": login.setCookie } })
  }))
  .handleRaw("deleteSession", ({ headers, request }) => Effect.map(CurrentSession, (current) => {
    const session = runtime.browserSession
    const authorized = session?.authorize({ cookie: current.cookie, method: "DELETE", csrfToken: headers["x-csrf-token"],
      origin: request.headers.origin, host: request.headers.host })
    if (session === undefined || authorized?.kind !== "authorized") {
      return HttpServerResponse.unsafeJson({ error: "csrf_validation_failed" }, { status: 403 })
    }
    session.revoke(current.cookie)
    return HttpServerResponse.unsafeJson({ authenticated: false }, { headers: { "set-cookie": session.clearCookie } })
  })))

const issuePath = (issue: { readonly path: ReadonlyArray<PropertyKey>, readonly message: string }): string => issue.path.length === 0
  ? issue.message
  : `${issue.path.map(String).join(".")}: ${issue.message}`
const decodeFailure = (failure: HttpApiError.HttpApiDecodeError) => Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const params = new URL(request.url, "http://qwbe.local").searchParams
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) {
    return HttpServerResponse.unsafeJson({ error: "ValidationFailure", issues: ["limit and cursor must be supplied at most once"] }, { status: 400 })
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
const failureMiddleware = HttpApiBuilder.middleware(mapDecodeFailures)
export interface ApiHandler {
  readonly handle: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

const methodFallbackLayer = HttpApiBuilder.Router.use((router) => Effect.gen(function*() {
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

export const createApiHandler = (runtime: ApiRuntime): ApiHandler => {
  const groups = Layer.mergeAll(invoicingGroup(runtime), documentsGroup(runtime), sessionsGroup(runtime))
  const routes = methodFallbackLayer.pipe(Layer.provideMerge(groups))
  const api = HttpApiBuilder.api(applicationHttpApi).pipe(
    Layer.provide(routes),
    Layer.provide(authenticationLayer(runtime)), Layer.provide(sessionAuthenticationLayer(runtime)),
  )
  const layer = Layer.mergeAll(api,
    failureMiddleware.pipe(Layer.provide(HttpApiBuilder.Middleware.layer)),
    HttpServer.layerContext)
  const finalMiddleware = (app: HttpApp.Default): HttpApp.Default => Effect.catchAllCause(
    app,
    (cause: Cause.Cause<unknown>) => {
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
    return Effect.succeed(HttpServerResponse.unsafeJson({ error: "internal_failure" }, { status: 500 }))
  })
  const web = HttpApiBuilder.toWebHandler(layer, { middleware: finalMiddleware })
  return { handle: web.handler, dispose: web.dispose }
}
