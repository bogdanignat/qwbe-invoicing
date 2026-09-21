import { QueryClient } from "@tanstack/react-query"
import { useState } from "react"

export const useAppQueryClient = (): QueryClient => {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  }))
  return client
}
