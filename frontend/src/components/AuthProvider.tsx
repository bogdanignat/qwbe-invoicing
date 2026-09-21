"use client"

import type { ReactNode } from "react"

import { AuthContext } from "../hooks/auth-context.ts"
import { useAuthController } from "../hooks/use-auth-controller.ts"

export const AuthProvider = ({ children }: { readonly children: ReactNode }) => {
  const controller = useAuthController()
  return <AuthContext value={controller}>{children}</AuthContext>
}
