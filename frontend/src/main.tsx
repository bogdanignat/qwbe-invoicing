import { RouterProvider, createRouter } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { parseSearch, stringifySearch } from "./lib/search-params.ts"
import { routeTree } from "./routeTree.gen.ts"
import "./styles/globals.css"

/**
 * One router for the page's lifetime, so the navigation every hook holds stays
 * the same function. The query string is kept as plain text pairs: the screens
 * own their addresses (`lib/search-params.ts`).
 *
 * `scrollRestoration`: a new page opens at the top, and Back or Forward returns
 * to where that history entry was left — each entry keeps its own position.
 */
const router = createRouter({ routeTree, parseSearch, stringifySearch, scrollRestoration: true })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const container = document.getElementById("root")
if (container === null) throw new Error("Lipsește elementul #root din index.html.")

createRoot(container).render(<StrictMode><RouterProvider router={router} /></StrictMode>)
