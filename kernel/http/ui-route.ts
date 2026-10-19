import type { ServerResponse } from "node:http"

import { send } from "./http-request-io.ts"
import type { UiBundle, UiFile } from "./ui-bundle.ts"

/**
 * Every path that is not the API's or a health check's belongs to the SPA. The
 * prefixes are matched without case, because the API router ignores case too:
 * `/API/x` is a missing API route, never a page.
 */
export const uiPath = (path: string): boolean => {
  const lower = path.toLowerCase()
  return !lower.startsWith("/api") && !lower.startsWith("/health")
}

const assetPrefix = "/assets/"

const sendFile = (response: ServerResponse, method: string, file: UiFile): void => {
  send(response, 200, method === "HEAD" ? new Uint8Array() : file.body, {
    "cache-control": file.cacheControl,
    "content-length": String(file.body.length),
    "content-type": file.contentType,
  })
}

/**
 * A file of the build when the path names one; otherwise `index.html`, so a deep
 * link (`/invoices/abc`) loads the application and its router takes over. A
 * missing file under `/assets/` is a 404: answering HTML for a script would only
 * hide a stale deploy behind a MIME error.
 */
export const serveUi = (bundle: UiBundle | undefined, method: string | undefined, path: string, response: ServerResponse): void => {
  if (method !== "GET" && method !== "HEAD") {
    send(response, 405, { error: "method_not_allowed" }, { allow: "GET, HEAD" })
    return
  }
  if (bundle === undefined) { send(response, 503, { error: "ui_not_built" }); return }
  const file = bundle.files.get(path)
  if (file !== undefined) { sendFile(response, method, file); return }
  if (path.startsWith(assetPrefix)) { send(response, 404, { error: "not_found" }); return }
  sendFile(response, method, bundle.index)
}
