import type { MouseEvent } from "react"

export const routeFromPathname = (pathname: string): string =>
  pathname === "/" || pathname === "/app" ? "/unlock" : pathname

export const currentRoute = (): string => routeFromPathname(window.location.pathname)

export const subscribeToRoute = (callback: () => void): (() => void) => {
  window.addEventListener("popstate", callback)
  return () => { window.removeEventListener("popstate", callback) }
}

export const navigate = (path: string, options: { readonly replace?: boolean } = {}): void => {
  window.history[options.replace === true ? "replaceState" : "pushState"](null, "", path)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export const handleNavigationClick = (event: MouseEvent<HTMLElement>): void => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!(event.target instanceof Element)) return
  const anchor = event.target.closest("a")
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target !== "" || anchor.hasAttribute("download")) return
  const href = anchor.getAttribute("href")
  if (href === null || !href.startsWith("/")) return
  const target = new URL(anchor.href)
  if (target.origin !== window.location.origin) return
  event.preventDefault()
  navigate(`${target.pathname}${target.search}${target.hash}`)
}
