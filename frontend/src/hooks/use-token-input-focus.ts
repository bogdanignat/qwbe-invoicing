import { useCallback } from "react"
import type { RefCallback } from "react"

export const useTokenInputFocus = (locked: boolean, pending: boolean): RefCallback<HTMLInputElement> =>
  useCallback((node) => {
    if (node !== null && locked && !pending) node.focus()
  }, [locked, pending])
