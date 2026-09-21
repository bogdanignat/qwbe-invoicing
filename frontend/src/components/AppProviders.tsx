"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { useAppQueryClient } from "../hooks/use-app-query-client.ts"
import { AuthProvider } from "./AuthProvider.tsx"

export const AppProviders = ({ children }: { readonly children: ReactNode }) => {
  const queryClient = useAppQueryClient()
  return <QueryClientProvider client={queryClient}><AuthProvider>{children}</AuthProvider></QueryClientProvider>
}
