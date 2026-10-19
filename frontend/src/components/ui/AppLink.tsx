import { Link } from "@tanstack/react-router"
import type { ComponentPropsWithoutRef } from "react"

/** No `target`: a link that opens elsewhere is a plain `<a>`, not a move inside the app. */
type AppLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href" | "target"> & { readonly href: string }

const EXACT = { exact: true } as const

/**
 * A link inside the app: the router moves to `href` without reloading the page.
 * `href` is an address `lib/` built and encoded, and it is followed as is.
 *
 * The router marks a link to the page on screen with `aria-current="page"`.
 * `exact` keeps that mark off a link to a section the page is only under — a
 * back link to the register is not the register — and a caller's own
 * `aria-current`, as the sidebar sets it, stays where the router adds none.
 */
export const AppLink = ({ href, ...props }: AppLinkProps) => <Link {...props} to={href} activeOptions={EXACT} />
