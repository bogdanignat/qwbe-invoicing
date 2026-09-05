// The single source of truth for browser routes: the SPA renders from it and the static host
// serves index.html for exactly these paths, so a route cannot exist on one side only.
export type UiRoute =
  | { readonly kind: "unlock" | "invoices" | "invoice-new" | "proformas" | "customers" | "products" | "settings" }
  | { readonly kind: "draft" | "invoice" | "proforma"; readonly id: string }
  | { readonly kind: "not-found" }

const staticRoutes: Readonly<Record<string, Extract<UiRoute, { kind: string }>["kind"]>> = {
  "/unlock": "unlock", "/invoices": "invoices", "/invoices/new": "invoice-new", "/proformas": "proformas",
  "/customers": "customers", "/products": "products", "/settings": "settings",
}
const detailRoutes: ReadonlyArray<{ readonly pattern: RegExp; readonly kind: "draft" | "invoice" | "proforma" }> = [
  { pattern: /^\/drafts\/([^/]+)$/, kind: "draft" },
  { pattern: /^\/invoices\/([^/]+)$/, kind: "invoice" },
  { pattern: /^\/proformas\/([^/]+)$/, kind: "proforma" },
]

export const matchUiRoute = (path: string): UiRoute => {
  const fixed = staticRoutes[path]
  if (fixed !== undefined) return { kind: fixed } as UiRoute
  for (const { pattern, kind } of detailRoutes) {
    const id = pattern.exec(path)?.[1]
    if (id !== undefined) return { kind, id: decodeURIComponent(id) }
  }
  return { kind: "not-found" }
}

export const entryPaths: ReadonlyArray<string> = ["/", "/app"]
export const isUiRoute = (path: string): boolean => entryPaths.includes(path) || matchUiRoute(path).kind !== "not-found"
