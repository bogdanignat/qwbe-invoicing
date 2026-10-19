import { createFileRoute } from "@tanstack/react-router"

import { ProductsView } from "../views/ProductsView.tsx"

export const Route = createFileRoute("/products")({ component: ProductsView })
