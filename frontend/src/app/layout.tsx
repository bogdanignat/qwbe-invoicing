import type { Metadata } from "next"
import type { ReactNode } from "react"

import { AppProviders } from "../components/AppProviders.tsx"
import "./globals.css"

export const metadata: Metadata = { title: "QWBE Invoicing", description: "Facturare locală QWBE" }
export const dynamic = "force-dynamic"

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return <html lang="ro"><body><AppProviders>{children}</AppProviders></body></html>
}
