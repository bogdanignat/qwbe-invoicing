import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "@effect/platform"
import { Schema } from "effect"

import { ANAF_ENVIRONMENTS, CALLBACK_OUTCOMES, CALLBACK_TARGET_PATH } from "../../cubes/invoicing/efactura/connection/index.ts"
import { body, conflict, invoicingBase } from "./http-api-shared.ts"

/** Never a token: what Settings → Integrations shows about the ANAF connection. */
export const EFacturaConnection = Schema.Struct({
  status: Schema.Literal("not_configured", "disconnected", "connected", "needs_reconnect"),
  environment: Schema.Literal(...ANAF_ENVIRONMENTS),
  verifiedCif: Schema.NullOr(Schema.String),
  refreshExpiresAt: Schema.NullOr(Schema.String),
  refreshExpiryWarning: Schema.Boolean,
  connectedBy: Schema.NullOr(Schema.String),
  connectedAt: Schema.NullOr(Schema.String),
  attempt: Schema.Literal("none", "pending", "expired").annotations({
    description: "pending/expired: an attempt you started never came back from ANAF; retry in a few minutes.",
  }),
})
export const EFacturaConnectionStart = Schema.Struct({
  authorizeUrl: Schema.String.annotations({ description: "ANAF's authorize URL; the browser goes there with the attempt cookie set." }),
})

const callbackDescription = [
  "ANAF's OAuth redirect. Public with respect to the login: its only credential is the `qwbe_anaf_oauth` attempt cookie.",
  `Always answers 303 to \`${CALLBACK_TARGET_PATH}?anaf=<code>\`, one of: ${CALLBACK_OUTCOMES.join(", ")}.`,
].join(" ")

/** The ANAF connection routes of the e-Factura plugin. */
export const efacturaConnectionEndpoints = {
  getEFacturaConnection: invoicingBase(HttpApiEndpoint.get("getEFacturaConnection", "/efactura/connection").addSuccess(EFacturaConnection)),
  startEFacturaConnection: invoicingBase(conflict(body(HttpApiEndpoint.post("startEFacturaConnection", "/efactura/connection/start")
    .addSuccess(EFacturaConnectionStart)))),
  disconnectEFactura: invoicingBase(body(HttpApiEndpoint.del("disconnectEFactura", "/efactura/connection").addSuccess(EFacturaConnection))),
  completeAnafCallback: HttpApiEndpoint.get("completeAnafCallback", "/anaf/callback").addSuccess(HttpApiSchema.Empty(303))
    .annotate(OpenApi.Description, callbackDescription),
} as const
