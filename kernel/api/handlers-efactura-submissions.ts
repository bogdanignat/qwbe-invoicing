import { randomUUID } from "node:crypto"

import { HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"

import type { InvoicingFailure } from "../../cubes/invoicing/index.ts"
import { efacturaPermissions } from "../../cubes/invoicing/efactura/connection/index.ts"
import {
  createSubmissionsService, type SubmissionDocument, type SubmissionsService, type Submitted, type SubmittedKind,
} from "../../cubes/invoicing/efactura/submissions/index.ts"
import { createPostgresSubmissionsStore } from "../storage/postgres-efactura-submissions.ts"
import { CurrentRequest } from "./api-context.ts"
import { errors } from "./api-failures.ts"
import { attachment, safeFilename } from "./api-responses.ts"
import { efacturaDocuments } from "./efactura-documents.ts"
import { EFacturaSubmission } from "./http-endpoints-efactura-submissions.ts"
import type { ApiRuntime, UseServices } from "./api-types.ts"

/** Encoded through the API schema, so only its fields leave (never the organization). */
export const submitted = ({ submission, created }: Submitted) =>
  Effect.orDie(HttpServerResponse.schemaJson(EFacturaSubmission)(submission, { status: created ? 202 : 200 }))

/**
 * The submission routes: the document is loaded from its frozen snapshot under
 * the invoicing grants (a proforma, or anything else that is not an issued
 * document, is a 404 here), and the submissions service decides the rest.
 */
export const submissionHandlers = (runtime: ApiRuntime, use: UseServices) => {
  const { invoice, correction } = efacturaDocuments(use)
  const anaf = runtime.anaf
  const environment = anaf?.environment ?? "test"
  const store = createPostgresSubmissionsStore(runtime.pool, environment)
  const submissions = <A, E>(operation: (service: SubmissionsService) => Effect.Effect<A, E>) => Effect.flatMap(CurrentRequest,
    (context) => operation(createSubmissionsService({
      context: { current: Effect.succeed(context) }, permissions: efacturaPermissions("efactura"),
      clock: { now: Effect.sync(runtime.now ?? (() => new Date())) }, ids: { next: Effect.sync(randomUUID) },
      store, configured: anaf?.client !== undefined, environment,
    })))
  const submit = (document: Effect.Effect<SubmissionDocument, InvoicingFailure, CurrentRequest>) => document.pipe(
    Effect.flatMap((loaded) => submissions((s) => s.submit(loaded))), Effect.flatMap(submitted),
    Effect.mapError(errors("ResourceNotFound", "ValidationFailure", "DomainConflict")))
  const history = (kind: SubmittedKind, document: Effect.Effect<unknown, InvoicingFailure, CurrentRequest>, id: string) => document.pipe(
    Effect.flatMap(() => submissions((s) => s.history(kind, id))), Effect.mapError(errors("ResourceNotFound")))
  const download = (read: (s: SubmissionsService) => Effect.Effect<Uint8Array, InvoicingFailure>, contentType: string, filename: string) =>
    submissions(read).pipe(Effect.map((bytes) => attachment(bytes, contentType, filename)), Effect.mapError(errors("ResourceNotFound")))
  return {
    submitInvoice: ({ path }: { readonly path: { readonly id: string } }) => submit(invoice(path.id)),
    submitCorrection: ({ path }: { readonly path: { readonly id: string } }) => submit(correction(path.id)),
    listInvoice: ({ path }: { readonly path: { readonly id: string } }) => history("invoice", invoice(path.id), path.id),
    listCorrection: ({ path }: { readonly path: { readonly id: string } }) => history("correction", correction(path.id), path.id),
    response: ({ path }: { readonly path: { readonly id: string } }) =>
      download((s) => s.response(path.id), "application/zip", `anaf-${safeFilename(path.id, "efactura")}.zip`),
    xml: ({ path }: { readonly path: { readonly id: string } }) =>
      download((s) => s.xml(path.id), "application/xml", `efactura-${safeFilename(path.id, "efactura")}.xml`),
  }
}
