import { Context } from "effect"

import type { RequestContext } from "../../cubes/invoicing/index.ts"

export class CurrentRequest extends Context.Tag("qwbe-invoicing/CurrentRequest")<CurrentRequest, RequestContext>() {}
export interface BrowserPrincipal { readonly csrfToken: string; readonly cookie: string }
export class CurrentSession extends Context.Tag("qwbe-invoicing/CurrentSession")<CurrentSession, BrowserPrincipal>() {}
